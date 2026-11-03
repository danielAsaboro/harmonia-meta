"""Timed visual observations from Muse Spark video understanding.

Muse Voice Transcribe hears a video; this module lets Muse Spark watch it. A
low-resolution proxy goes to the Responses API with a strict JSON schema, and
each returned observation is anchored to a real still: ffmpeg extracts the frame
at that timestamp and it is stored as a source artifact. Nimi then receives the
observation as a ``frame`` evidence segment it can cite for visual claims.

Docs: docs/meta-model-api/video-understanding.md, structured-output.md.
"""

from __future__ import annotations

import base64
import logging
import os
import subprocess
import tempfile
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable

import httpx

from . import meta_api
from .model_catalog import PRICING_VERSION, estimate_text_cost
from .telemetry import current_trace_id, safe_attributes, tracer
from .usage import InvocationContext, UsageRecord
from .web_client import report_usage, reserve_budget, resolve_budget_reservation

MAX_OBSERVATIONS = 20
PROXY_WIDTH = 480
MAX_PROXY_BYTES = 45_000_000
# Meta does not publish a per-second video token rate; reserve against a
# deliberately high estimate and record the provider-reported usage afterwards.
ESTIMATED_INPUT_TOKENS_PER_SECOND = 400
MAX_OUTPUT_TOKENS = 6000
logger = logging.getLogger("harmonia.video_understanding")

OBSERVATION_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "observations": {
            "type": "array",
            "maxItems": MAX_OBSERVATIONS,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "timestampSec": {"type": "number"},
                    "observation": {"type": "string"},
                },
                "required": ["timestampSec", "observation"],
            },
        },
    },
    "required": ["observations"],
}

PROMPT = (
    "Watch this video and list up to 20 distinct visual moments a social editor could use: "
    "what is on screen (people, product UI, charts, on-screen text, demos, gestures, scene changes). "
    "For each, give the timestamp in seconds from the start and one factual sentence describing only "
    "what is visible. Do not transcribe speech, guess identities, or infer intent."
)


class VideoUnderstandingError(RuntimeError):
    pass


def video_model() -> str:
    return os.environ.get("ANALYST_MODEL_ID") or os.environ.get("MODEL_ID") or "muse-spark-1.3"


def has_video_stream(path: Path) -> bool:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_type",
         "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    return proc.returncode == 0 and proc.stdout.strip() == "video"


def _ffmpeg(args: list[str]) -> None:
    proc = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *args], capture_output=True, text=True, timeout=600)
    if proc.returncode != 0:
        raise VideoUnderstandingError(f"ffmpeg failed: {(proc.stderr or '')[-200:]}")


def _proxy(source: Path, workdir: Path, fps: int) -> Path:
    proxy = workdir / f"proxy-{fps}.mp4"
    _ffmpeg(["-i", str(source), "-an", "-vf", f"fps={fps},scale={PROXY_WIDTH}:-2",
             "-c:v", "libx264", "-preset", "veryfast", "-crf", "32", "-pix_fmt", "yuv420p",
             "-movflags", "+faststart", str(proxy)])
    return proxy


def _small_proxy(source: Path, workdir: Path) -> bytes:
    for fps in (2, 1):
        data = _proxy(source, workdir, fps).read_bytes()
        if len(data) <= MAX_PROXY_BYTES:
            return data
    raise VideoUnderstandingError("video is too long for inline visual analysis")


def extract_frame(source: Path, timestamp_sec: float, workdir: Path) -> bytes:
    still = workdir / f"frame-{int(timestamp_sec * 1000)}.jpg"
    _ffmpeg(["-ss", f"{max(timestamp_sec, 0):.3f}", "-i", str(source), "-frames:v", "1",
             "-vf", "scale=960:-2", "-q:v", "4", str(still)])
    if not still.exists():
        raise VideoUnderstandingError(f"no frame at {timestamp_sec:.2f}s")
    return still.read_bytes()


def _output_text(body: dict[str, Any]) -> str:
    if isinstance(body.get("output_text"), str):
        return body["output_text"]
    for item in body.get("output") or []:
        for block in (item.get("content") or []) if isinstance(item, dict) else []:
            if isinstance(block, dict) and block.get("type") == "output_text":
                return str(block.get("text") or "")
    return ""


def _http_client(timeout: float) -> httpx.Client:
    return meta_api.client(timeout, purpose="Muse Spark video understanding")


def _observe(client: httpx.Client, model: str, video: bytes) -> tuple[str, dict[str, Any]]:
    response = client.post("/responses", json={
        "model": model,
        "reasoning": {"effort": "low"},
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": PROMPT},
            {"type": "input_video", "video_url": "data:video/mp4;base64," + base64.b64encode(video).decode()},
        ]}],
        "text": {"format": {"type": "json_schema", "name": "VisualObservations", "schema": OBSERVATION_SCHEMA, "strict": True}},
    })
    if response.status_code >= 300:
        raise VideoUnderstandingError(f"video understanding failed ({response.status_code}): {response.text[:200]}")
    body = response.json()
    return _output_text(body), dict(body.get("usage") or {})


def parse_observations(text: str, duration_sec: float) -> list[tuple[float, str]]:
    """Keep in-range, non-empty observations in time order, at most one per half second."""
    import json

    try:
        raw = json.loads(text)["observations"]
    except (ValueError, KeyError, TypeError) as exc:
        raise VideoUnderstandingError("video understanding returned malformed JSON") from exc
    kept: list[tuple[float, str]] = []
    for item in sorted(
        (item for item in raw if isinstance(item, dict)),
        key=lambda item: float(item.get("timestampSec") or 0),
    ):
        timestamp = float(item.get("timestampSec") or 0)
        observation = str(item.get("observation") or "").strip()
        if not observation or not 0 <= timestamp < duration_sec:
            continue
        if kept and timestamp - kept[-1][0] < 0.5:
            continue
        kept.append((timestamp, observation[:500]))
    return kept[:MAX_OBSERVATIONS]


def observe_video(
    source: Path,
    duration_sec: float,
    *,
    invocation: InvocationContext,
    store_frame: Callable[[bytes], str],
    observe: Callable[[httpx.Client, str, bytes], tuple[str, dict[str, Any]]] = _observe,
    client_factory: Callable[[float], httpx.Client] = _http_client,
    budget_reserver: Callable[[dict[str, object]], None] = reserve_budget,
    budget_resolver: Callable[[dict[str, object]], None] = resolve_budget_reservation,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> list[tuple[float, str, str]]:
    """Return ``(timestampSec, observation, frameArtifactId)`` for each visual moment."""
    role = "video_observer"
    model = video_model()
    operation_id = invocation.role_operation_id(role)
    estimated_input = int(duration_sec * ESTIMATED_INPUT_TOKENS_PER_SECOND) + 500
    estimate = estimate_text_cost(model, estimated_input, MAX_OUTPUT_TOKENS)
    budget_reserver({
        "jobId": invocation.job_id, "operationId": operation_id, "stage": invocation.stage,
        "role": role, "model": model, "estimatedCostUsd": str(estimate),
        "pricingVersion": PRICING_VERSION,
    })
    state = "reserved"
    try:
        with tempfile.TemporaryDirectory() as td, tracer().start_as_current_span("harmonia.model.generate") as span:
            span.set_attributes(safe_attributes({
                "job.id": invocation.job_id, "stage": invocation.stage, "agent": role, "model": model,
            }))
            video = _small_proxy(source, Path(td))
            with client_factory(600.0) as client:
                state = "dispatched"
                text, usage = observe(client, model, video)
            input_tokens = int(usage.get("input_tokens") or estimated_input)
            output_tokens = int(usage.get("output_tokens") or 0)
            cached_tokens = min(int((usage.get("input_tokens_details") or {}).get("cached_tokens") or 0), input_tokens)
            cost = estimate_text_cost(model, input_tokens, output_tokens, cached_tokens)
            usage_reporter(UsageRecord(
                id=f"usage-{sha256(operation_id.encode()).hexdigest()[:24]}",
                job_id=invocation.job_id, operation_id=operation_id, stage=invocation.stage,
                role=role, model=model, input_units=input_tokens, output_units=output_tokens,
                cached_input_units=cached_tokens or None, unit_type="tokens", estimated_cost_usd=str(cost),
                trace_id=current_trace_id(), created_at=datetime.now(timezone.utc).isoformat(),
            ).to_wire())
            state = "reported"
            anchored: list[tuple[float, str, str]] = []
            for timestamp, observation in parse_observations(text, duration_sec):
                try:
                    anchored.append((timestamp, observation, store_frame(extract_frame(source, timestamp, Path(td)))))
                except VideoUnderstandingError:
                    logger.warning("dropped visual observation at %.2fs: no extractable frame", timestamp)
            span.set_attributes(safe_attributes({
                "input.units": input_tokens, "output.units": output_tokens,
                "cost.estimated_usd": str(cost), "video.observations": len(anchored),
            }))
            return anchored
    except Exception:
        if state != "reported":
            try:
                budget_resolver({
                    "jobId": invocation.job_id, "operationId": operation_id,
                    "outcome": "uncertain" if state == "dispatched" else "not_invoked",
                    "reason": f"video understanding failed {'after' if state == 'dispatched' else 'before'} provider dispatch",
                })
            except Exception:  # noqa: BLE001 - preserve the causal failure
                logger.exception("budget resolution failed for operation %s", operation_id)
        raise
