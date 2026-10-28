"""Meta Model API media operations plus deterministic content-pack assembly."""

from __future__ import annotations

import base64
import io
import json
import logging
import os
import subprocess
import tempfile
import wave
from collections.abc import Callable
from datetime import datetime, timezone
from decimal import ROUND_CEILING, Decimal
from hashlib import sha256
from pathlib import Path

import httpx

from .config import settings
from .model_catalog import PRICING_VERSION
from .telemetry import current_trace_id, safe_attributes, tracer
from .usage import InvocationContext, UsageRecord
from .web_client import report_usage, reserve_budget, resolve_budget_reservation
from . import youtube

DEFAULT_META_API_BASE_URL = "https://api.meta.ai/v1"
DEFAULT_TRANSCRIBER_MODEL = "muse-voice-transcribe-1.0"
DEFAULT_IMAGE_MODEL = "muse-image-1.0"
# docs/meta-model-api/pricing-rate-limits.md: Muse Voice Transcribe is $0.18 per
# hour of audio processed, billed in whole seconds rounded down.
TRANSCRIBE_USD_PER_SECOND = Decimal("0.18") / Decimal(3600)
# docs/meta-model-api/speech-to-text.md: /v1/asr/transcribe accepts mono 16-bit
# PCM WAV at 16/24 kHz, at most 10 minutes and 32 MB per request. 24 kHz mono
# 16-bit is 48,000 bytes/s, so a 590 s clip (~28.3 MB) stays under both caps.
TRANSCRIBE_SAMPLE_RATE = 24_000
MAX_TRANSCRIBE_CLIP_SECONDS = 590
IMAGE_MIME_TYPES = {"png": "image/png", "jpeg": "image/jpeg", "webp": "image/webp"}
logger = logging.getLogger("harmonia.content")


def _resolve_without_masking(
    resolver: Callable[[dict[str, object]], None], payload: dict[str, object],
) -> None:
    try:
        resolver(payload)
    except Exception:  # noqa: BLE001 - preserve the causal provider failure
        logger.exception("budget resolution failed for operation %s", payload["operationId"])


def _http_client(timeout: float) -> httpx.Client:
    api_key = os.environ.get("MODEL_API_KEY")
    if not api_key:
        raise RuntimeError("MODEL_API_KEY is required for Meta Model API media calls")
    base_url = os.environ.get("META_API_BASE_URL") or DEFAULT_META_API_BASE_URL
    return httpx.Client(
        base_url=base_url.rstrip("/"),
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=httpx.Timeout(timeout, connect=10.0),
    )


def model_used() -> str:
    return os.environ.get("TRANSCRIBER_MODEL_ID") or DEFAULT_TRANSCRIBER_MODEL


def image_model() -> str:
    return os.environ.get("IMAGE_MODEL_ID") or DEFAULT_IMAGE_MODEL


def _usd(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.000001"), rounding=ROUND_CEILING))


def transcription_cost_usd(seconds: int) -> str:
    return _usd(Decimal(seconds) * TRANSCRIBE_USD_PER_SECOND)


def _normalize_to_wav(media: bytes) -> bytes:
    """Decode any audio/video container to mono 16-bit 24 kHz PCM WAV."""
    with tempfile.TemporaryDirectory() as td:
        source, target = Path(td) / "source", Path(td) / "audio.wav"
        source.write_bytes(media)
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-i", str(source), "-vn",
             "-ac", "1", "-ar", str(TRANSCRIBE_SAMPLE_RATE), "-c:a", "pcm_s16le",
             "-map_metadata", "-1", "-f", "wav", str(target)],
            capture_output=True, text=True, timeout=600,
        )
        if proc.returncode != 0 or not target.exists():
            raise RuntimeError(f"ffmpeg WAV normalization failed: {(proc.stderr or '')[-200:]}")
        return target.read_bytes()


def _split_wav(wav_bytes: bytes, max_seconds: int = MAX_TRANSCRIBE_CLIP_SECONDS) -> list[tuple[int, bytes]]:
    """Split a PCM WAV into (offset_ms, wav_clip) pieces of at most max_seconds."""
    with wave.open(io.BytesIO(wav_bytes), "rb") as reader:
        params = reader.getparams()
        frames_per_clip = params.framerate * max_seconds
        clips: list[tuple[int, bytes]] = []
        offset_frames = 0
        while True:
            frames = reader.readframes(frames_per_clip)
            if not frames:
                break
            out = io.BytesIO()
            with wave.open(out, "wb") as writer:
                writer.setnchannels(params.nchannels)
                writer.setsampwidth(params.sampwidth)
                writer.setframerate(params.framerate)
                writer.writeframes(frames)
            clips.append((offset_frames * 1000 // params.framerate, out.getvalue()))
            offset_frames += len(frames) // (params.sampwidth * params.nchannels)
    if not clips:
        raise ValueError("normalized audio contains no frames")
    return clips


def _transcribe_clip(client: httpx.Client, model: str, session_id: str, clip: bytes) -> dict:
    response = client.post(
        "/asr/transcribe",
        params={"sessionId": session_id},
        headers={"Accept": "application/json"},
        files={
            "request": (None, json.dumps({"model": model, "mode": "ENDPOINTING", "audioEncoding": "WAV"}), "application/json"),
            "audio": ("audio.wav", clip, "audio/wav"),
        },
    )
    response.raise_for_status()
    return response.json()


def _segments_from_turns(result: dict, offset_ms: int, clip_index: int) -> list[dict]:
    segments = []
    for turn in result.get("turns") or []:
        text = str(turn.get("transcript") or "").strip()
        if not text:
            continue
        segments.append({
            "id": f"c{clip_index}-t{turn.get('turnId')}",
            "startSec": (offset_ms + int(turn.get("startMs") or 0)) / 1000,
            "endSec": (offset_ms + int(turn.get("endMs") or 0)) / 1000,
            "text": text,
        })
    transcript = str(result.get("transcript") or "").strip()
    if not segments and transcript:
        # No detected turns: the clip itself is the only honest time range.
        segments.append({
            "id": f"c{clip_index}",
            "startSec": offset_ms / 1000,
            "endSec": (offset_ms + int(result.get("audioDurationMs") or 0)) / 1000,
            "text": transcript,
        })
    return segments


def transcribe_audio(
    audio: bytes,
    mime_type: str,
    *,
    invocation: InvocationContext | None = None,
    budget_reserver: Callable[[dict[str, object]], None] = reserve_budget,
    budget_resolver: Callable[[dict[str, object]], None] = resolve_budget_reservation,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> dict:
    """Transcribe media with Muse Voice Transcribe into timed turn segments.

    Returns ``{"language": "und", "segments": [{id, startSec, endSec, text}]}``.
    The provider returns turn-level timestamps only and no language label.
    """
    if invocation is None:
        raise ValueError("real transcription requires invocation context")
    role = "transcriber"
    model = model_used()
    operation_id = invocation.role_operation_id(role)
    budget_reserver({
        "jobId": invocation.job_id,
        "operationId": operation_id,
        "stage": invocation.stage,
        "role": role,
        "model": model,
        "estimatedCostUsd": transcription_cost_usd(youtube.probe_audio_duration(audio) + 1),
        "pricingVersion": PRICING_VERSION,
    })
    dispatched = False
    try:
        clips = _split_wav(_normalize_to_wav(audio))
        session_prefix = sha256(operation_id.encode()).hexdigest()[:24]
        with tracer().start_as_current_span("harmonia.model.generate") as span:
            span.set_attributes(safe_attributes({
                "job.id": invocation.job_id,
                "stage": invocation.stage,
                "agent": role,
                "model": model,
            }))
            segments: list[dict] = []
            billed_seconds = 0
            with _http_client(timeout=300.0) as client:
                for index, (offset_ms, clip) in enumerate(clips):
                    dispatched = True
                    result = _transcribe_clip(client, model, f"{session_prefix}-{index}", clip)
                    billed_seconds += int(result.get("audioDurationMs") or 0) // 1000
                    segments.extend(_segments_from_turns(result, offset_ms, index))
            cost = transcription_cost_usd(billed_seconds)
            record = UsageRecord(
                id=f"usage-{sha256(operation_id.encode()).hexdigest()[:24]}",
                job_id=invocation.job_id,
                operation_id=operation_id,
                stage=invocation.stage,
                role=role,
                model=model,
                input_units=billed_seconds,
                output_units=0,
                unit_type="audio_seconds",
                estimated_cost_usd=cost,
                trace_id=current_trace_id(),
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            span.set_attributes(safe_attributes({
                "input.units": billed_seconds,
                "output.units": 0,
                "cost.estimated_usd": cost,
            }))
            usage_reporter(record.to_wire())
            return {"language": "und", "segments": segments}
    except Exception:  # noqa: BLE001 - preserve the original provider failure
        _resolve_without_masking(budget_resolver, {
            "jobId": invocation.job_id,
            "operationId": operation_id,
            "outcome": "uncertain" if dispatched else "not_invoked",
            "reason": (
                "transcription failed after provider dispatch"
                if dispatched else "transcription failed before provider dispatch"
            ),
        })
        raise


class ImageGenError(RuntimeError):
    pass


def generate_image(
    prompt: str,
    *,
    invocation: InvocationContext | None = None,
    budget_reserver: Callable[[dict[str, object]], None] = reserve_budget,
    budget_resolver: Callable[[dict[str, object]], None] = resolve_budget_reservation,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> tuple[bytes, str]:
    """Generate one image with Muse Image and return its bytes and MIME type."""
    if invocation is None:
        raise ValueError("real image generation requires invocation context")
    role = "image_generator"
    model = image_model()
    operation_id = invocation.role_operation_id(role)
    maximum_cost = settings().image_max_cost_usd
    budget_reserver({
        "jobId": invocation.job_id,
        "operationId": operation_id,
        "stage": invocation.stage,
        "role": role,
        "model": model,
        "estimatedCostUsd": maximum_cost,
        "pricingVersion": PRICING_VERSION,
    })
    dispatched = False
    try:
        with _http_client(timeout=180.0) as client, \
                tracer().start_as_current_span("harmonia.model.generate") as span:
            span.set_attributes(safe_attributes({
                "job.id": invocation.job_id,
                "stage": invocation.stage,
                "agent": role,
                "model": model,
            }))
            dispatched = True
            response = client.post("/images/generations", json={
                "model": model,
                "prompt": prompt,
                "n": 1,
                "response_format": "b64_json",
                "output_format": "png",
            })
            response.raise_for_status()
            body = response.json()
            images = body.get("data") or []
            encoded = images[0].get("b64_json") if images else None
            if not encoded:
                raise ImageGenError(f"{model} returned no images")
            mime = IMAGE_MIME_TYPES.get(str(body.get("output_format") or "png"))
            if mime is None:
                raise ImageGenError(f"{model} returned unsupported format {body.get('output_format')!r}")
            image_bytes = base64.b64decode(encoded)
            record = UsageRecord(
                id=f"usage-{sha256(operation_id.encode()).hexdigest()[:24]}",
                job_id=invocation.job_id,
                operation_id=operation_id,
                stage=invocation.stage,
                role=role,
                model=model,
                input_units=1,
                output_units=0,
                unit_type="images",
                estimated_cost_usd=maximum_cost,
                trace_id=current_trace_id(),
                created_at=datetime.now(timezone.utc).isoformat(),
            )
            span.set_attributes(safe_attributes({
                "input.units": 1,
                "output.units": 0,
                "cost.estimated_usd": maximum_cost,
            }))
            usage_reporter(record.to_wire())
            return image_bytes, mime
    except Exception as exc:  # noqa: BLE001 - normalized for stage failure classification
        _resolve_without_masking(budget_resolver, {
            "jobId": invocation.job_id,
            "operationId": operation_id,
            "outcome": "uncertain" if dispatched else "not_invoked",
            "reason": (
                "provider request outcome is unknown after dispatch"
                if dispatched else "provider request was not dispatched"
            ),
        })
        if isinstance(exc, ImageGenError):
            raise
        raise ImageGenError(f"image generation failed: {exc}") from exc


def build_content_pack(title: str, url: str, moments: list, angles: list, drafts: list) -> str:
    lines = [f"# Harmonia Content Pack — {title}", "", f"Source: {url}", ""]
    lines.append("## Clip moments")
    for moment in moments:
        lines.append(
            f"- **{moment['title']}** ({int(moment['startSec'])}s–{int(moment['endSec'])}s): "
            f"{moment['hook']}"
        )
        lines.append(f'  > "{moment["quote"]}"')
    lines.append("\n## Trend & meme angles")
    for angle in angles:
        lines.append(f"- [{angle['kind'].upper()}] {angle['title']} — {angle['rationale']}")
    lines.append("\n## Ready-to-post drafts")
    for draft in drafts:
        lines.append(f"### {draft['platform'].upper()}")
        lines.append(f"> {draft['text']}")
    lines.append("\n---\nAssembled by Harmonia from persisted pipeline artifacts.")
    return "\n".join(lines)
