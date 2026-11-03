"""Subject-tracked reframing with SAM 3.1 on Meta Model API.

A vertical or square cut of landscape footage needs a crop window. Instead of a
blind center crop, Harmonia asks SAM 3.1 to track the subject (by default a
person) through a low-frame-rate proxy of the clip and pans the crop to follow
the dominant tracked object. Only boxes are read; masks are ignored.

Wire format: docs/meta-model-api/sam/reading-segmentation.md. Pricing: $0.20 per
1,000 video frames, at least 50 frames per request.
"""

from __future__ import annotations

import base64
import logging
import os
import re
import subprocess
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import ROUND_CEILING, Decimal
from hashlib import sha256
from pathlib import Path
from statistics import median
from typing import Any, Callable

import httpx

from .model_catalog import PRICING_VERSION
from .telemetry import current_trace_id, safe_attributes, tracer
from .usage import InvocationContext, UsageRecord
from .web_client import report_usage, reserve_budget, resolve_budget_reservation

DEFAULT_META_API_BASE_URL = "https://api.meta.ai/v1"
DEFAULT_SEGMENTATION_MODEL = "sam-3.1"
SAM_USD_PER_FRAME = Decimal("0.20") / Decimal(1000)
SAM_MIN_BILLED_FRAMES = 50
# A 5 fps, 640 px proxy keeps a 60 s clip at 300 billed frames ($0.06) and well
# under the 50 MB inline limit, while boxes stay precise enough to frame a person.
PROXY_FPS = 5
PROXY_WIDTH = 640
MAX_PROXY_BYTES = 45_000_000
KEYFRAME_SECONDS = 0.5
# Ignore subject drift smaller than this share of the frame so the crop holds still.
DEAD_ZONE = 0.04
logger = logging.getLogger("harmonia.segmentation")

_FRAME = re.compile(r"<(\d+)f>")
_RECORD = re.compile(r"(\d+)<\|box;([^|]*)\|>")


class SegmentationError(RuntimeError):
    pass


@dataclass(frozen=True)
class Box:
    object_id: int
    x1: int
    y1: int
    x2: int
    y2: int
    width: int
    height: int

    @property
    def area(self) -> int:
        return max(self.x2 - self.x1, 0) * max(self.y2 - self.y1, 0)

    @property
    def center_x(self) -> float:
        return (self.x1 + self.x2) / 2


@dataclass(frozen=True)
class SubjectCrop:
    """A crop window of fixed size whose left edge pans through keyframes."""

    width: int
    height: int
    keyframes: tuple[tuple[float, int], ...]

    def filter(self) -> str:
        return f"crop={self.width}:{self.height}:x='{self.x_expression()}':y=0"

    def x_expression(self) -> str:
        frames = self.keyframes
        if len(frames) == 1:
            return str(frames[0][1])
        expression = str(frames[-1][1])
        for (t0, x0), (t1, x1) in reversed(list(zip(frames, frames[1:]))):
            if x0 == x1:
                segment = str(x0)
            else:
                segment = f"{x0}+({x1 - x0})*(t-{t0:.2f})/{t1 - t0:.2f}"
            expression = f"if(lt(t,{t1:.2f}),{segment},{expression})"
        return f"if(lt(t,{frames[0][0]:.2f}),{frames[0][1]},{expression})"


def parse_boxes(text: str) -> dict[int, list[Box]]:
    """Read every frame's boxes from SAM output, keyed by the explicit frame index."""
    frames: dict[int, list[Box]] = {}
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        marker = _FRAME.match(line)
        if marker is None:
            raise SegmentationError("segmentation line has no frame marker")
        boxes: list[Box] = []
        for object_id, fields in _RECORD.findall(line[marker.end():]):
            values = dict(part.split("=", 1) for part in fields.split(";") if "=" in part)
            try:
                boxes.append(Box(
                    object_id=int(object_id),
                    x1=int(values["x1"]), y1=int(values["y1"]),
                    x2=int(values["x2"]), y2=int(values["y2"]),
                    width=int(values["w"]), height=int(values["h"]),
                ))
            except (KeyError, ValueError) as exc:
                raise SegmentationError("segmentation box is malformed") from exc
        frames[int(marker.group(1))] = boxes
    return frames


def plan_subject_crop(
    frames: dict[int, list[Box]],
    *,
    fps: float,
    source_width: int,
    source_height: int,
    aspect: float,
) -> SubjectCrop | None:
    """Pan a fixed crop to follow the object that occupies the most frame area.

    Returns None when the target aspect already fits the source or no subject
    was tracked, so the caller keeps the full frame instead of guessing.
    """
    crop_width = int(source_height * aspect) // 2 * 2
    if crop_width >= source_width or not frames:
        return None
    totals: dict[int, int] = {}
    for boxes in frames.values():
        for box in boxes:
            totals[box.object_id] = totals.get(box.object_id, 0) + box.area
    if not totals:
        return None
    subject = max(totals, key=lambda object_id: (totals[object_id], -object_id))
    centers: dict[int, list[float]] = {}
    for index, boxes in frames.items():
        for box in boxes:
            if box.object_id == subject and box.width > 0:
                bucket = int(index / fps / KEYFRAME_SECONDS)
                centers.setdefault(bucket, []).append(box.center_x * source_width / box.width)
    if not centers:
        return None
    max_x = source_width - crop_width
    dead_zone = DEAD_ZONE * source_width
    keyframes: list[tuple[float, int]] = []
    for bucket in sorted(centers):
        x = int(min(max(median(centers[bucket]) - crop_width / 2, 0), max_x))
        if keyframes and abs(x - keyframes[-1][1]) < dead_zone:
            continue
        keyframes.append((bucket * KEYFRAME_SECONDS, x))
    return SubjectCrop(width=crop_width, height=source_height, keyframes=tuple(keyframes))


def _usd(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.000001"), rounding=ROUND_CEILING))


def segmentation_cost_usd(frames: int) -> str:
    return _usd(Decimal(max(frames, SAM_MIN_BILLED_FRAMES)) * SAM_USD_PER_FRAME)


def segmentation_model() -> str:
    return os.environ.get("SEGMENTATION_MODEL_ID") or DEFAULT_SEGMENTATION_MODEL


def _proxy(source: Path, start: float, end: float, workdir: Path) -> Path:
    proxy = workdir / "sam-proxy.mp4"
    proc = subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{max(start, 0):.3f}", "-to", f"{end:.3f}",
         "-i", str(source), "-an", "-vf", f"fps={PROXY_FPS},scale={PROXY_WIDTH}:-2",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p",
         "-movflags", "+faststart", str(proxy)],
        capture_output=True, text=True, timeout=600,
    )
    if proc.returncode != 0 or not proxy.exists():
        raise SegmentationError(f"ffmpeg proxy encode failed: {(proc.stderr or '')[-200:]}")
    if proxy.stat().st_size > MAX_PROXY_BYTES:
        raise SegmentationError("segmentation proxy exceeds the inline video limit")
    return proxy


def _output_text(body: dict[str, Any]) -> str:
    if isinstance(body.get("output_text"), str):
        return body["output_text"]
    parts: list[str] = []
    for item in body.get("output") or []:
        for block in (item.get("content") or []) if isinstance(item, dict) else []:
            if isinstance(block, dict) and block.get("type") == "output_text":
                parts.append(str(block.get("text") or ""))
    return "\n".join(parts)


def _segment(client: httpx.Client, model: str, subject: str, video: bytes) -> tuple[str, int | None]:
    response = client.post("/responses", json={
        "model": model,
        "input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": subject},
            {"type": "input_video", "video_url": "data:video/mp4;base64," + base64.b64encode(video).decode()},
        ]}],
        "metadata": {"mask_encoding": "one_bit"},
    })
    if response.status_code >= 300:
        raise SegmentationError(f"SAM request failed ({response.status_code}): {response.text[:200]}")
    body = response.json()
    billed = (body.get("usage") or {}).get("video_frames_processed")
    return _output_text(body), int(billed) if isinstance(billed, int) else None


def _http_client(timeout: float) -> httpx.Client:
    api_key = os.environ.get("MODEL_API_KEY")
    if not api_key:
        raise RuntimeError("MODEL_API_KEY is required for SAM 3.1 segmentation")
    base_url = os.environ.get("META_API_BASE_URL") or DEFAULT_META_API_BASE_URL
    return httpx.Client(
        base_url=base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=httpx.Timeout(timeout, connect=10.0),
    )


def track_subject_crop(
    source: Path,
    *,
    start: float,
    end: float,
    source_width: int,
    source_height: int,
    aspect: float,
    subject: str,
    invocation: InvocationContext,
    segment: Callable[[httpx.Client, str, str, bytes], tuple[str, int | None]] = _segment,
    client_factory: Callable[[float], httpx.Client] = _http_client,
    budget_reserver: Callable[[dict[str, object]], None] = reserve_budget,
    budget_resolver: Callable[[dict[str, object]], None] = resolve_budget_reservation,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> SubjectCrop | None:
    """Track ``subject`` through [start, end] and plan a crop that follows it."""
    if int(source_height * aspect) >= source_width:
        return None
    role = "segmenter"
    model = segmentation_model()
    operation_id = invocation.role_operation_id(role)
    estimated_frames = int((end - start) * PROXY_FPS) + 1
    budget_reserver({
        "jobId": invocation.job_id, "operationId": operation_id, "stage": invocation.stage,
        "role": role, "model": model,
        "estimatedCostUsd": segmentation_cost_usd(estimated_frames),
        "pricingVersion": PRICING_VERSION,
    })
    dispatched = False
    try:
        with tempfile.TemporaryDirectory() as td, tracer().start_as_current_span("harmonia.model.generate") as span:
            span.set_attributes(safe_attributes({
                "job.id": invocation.job_id, "stage": invocation.stage, "agent": role, "model": model,
            }))
            video = _proxy(source, start, end, Path(td)).read_bytes()
            with client_factory(300.0) as client:
                dispatched = True
                text, billed = segment(client, model, subject, video)
            frames = parse_boxes(text)
            billed_frames = max(billed or estimated_frames, SAM_MIN_BILLED_FRAMES)
            cost = segmentation_cost_usd(billed_frames)
            usage_reporter(UsageRecord(
                id=f"usage-{sha256(operation_id.encode()).hexdigest()[:24]}",
                job_id=invocation.job_id, operation_id=operation_id, stage=invocation.stage,
                role=role, model=model, input_units=billed_frames, output_units=0,
                unit_type="video_frames", estimated_cost_usd=cost,
                trace_id=current_trace_id(), created_at=datetime.now(timezone.utc).isoformat(),
            ).to_wire())
            span.set_attributes(safe_attributes({
                "input.units": billed_frames, "cost.estimated_usd": cost,
                "segmentation.tracked_frames": len(frames),
            }))
            return plan_subject_crop(
                frames, fps=PROXY_FPS, source_width=source_width,
                source_height=source_height, aspect=aspect,
            )
    except Exception:
        try:
            budget_resolver({
                "jobId": invocation.job_id, "operationId": operation_id,
                "outcome": "uncertain" if dispatched else "not_invoked",
                "reason": "segmentation failed after provider dispatch" if dispatched
                else "segmentation failed before provider dispatch",
            })
        except Exception:  # noqa: BLE001 - preserve the causal provider failure
            logger.exception("budget resolution failed for operation %s", operation_id)
        raise
