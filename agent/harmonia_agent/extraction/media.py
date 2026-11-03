"""Audio and video normalization with real time-range evidence."""

from __future__ import annotations

import logging
import tempfile
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Callable

import httpx

from .. import content, video_understanding, youtube
from ..agent_models import ContentSegment, FrameLocator, NormalizedSource, TimeRangeLocator
from ..usage import InvocationContext

logger = logging.getLogger("harmonia.extraction.media")


def _store_frame(invocation: InvocationContext) -> Callable[[bytes], str]:
    from ..web_client import create_artifact

    def store(jpeg: bytes) -> str:
        return str(create_artifact(
            job_id=invocation.job_id, operation_id=invocation.operation_id, content=jpeg,
            content_type="image/jpeg", trust="operator",
            producer={"kind": "extractor", "id": "video-frame", "version": "1"},
            retention_class="source",
        )["id"])

    return store


def _visual_segments(body: bytes, duration: float, invocation: InvocationContext, first_index: int) -> list[ContentSegment]:
    """Muse Spark watches the video; each observation is anchored to a stored frame."""
    with tempfile.TemporaryDirectory() as td:
        path = Path(td) / "source"
        path.write_bytes(body)
        if not video_understanding.has_video_stream(path):
            return []
        try:
            observations = video_understanding.observe_video(
                path, duration, invocation=invocation, store_frame=_store_frame(invocation),
            )
        except (video_understanding.VideoUnderstandingError, httpx.HTTPError, RuntimeError) as exc:
            # Visual evidence is additive; the transcript still grounds the analysis.
            logger.warning("visual extraction skipped for %s: %s", invocation.operation_id, exc)
            return []
    return [
        ContentSegment(
            id=f"frame-{first_index + index}", text=observation,
            locator=FrameLocator(timestampMs=round(timestamp * 1000), frameArtifactId=artifact_id),
            digest=sha256(observation.encode("utf-8")).hexdigest(),
        )
        for index, (timestamp, observation, artifact_id) in enumerate(observations, start=1)
    ]


def extract_media(
    source_id: str,
    title: str,
    body: bytes,
    mime_type: str,
    *,
    invocation: InvocationContext,
    receipt_id: str,
) -> NormalizedSource:
    if not body:
        raise ValueError("media source is empty")
    transcript = content.transcribe_audio(body, mime_type, invocation=invocation)
    segments = []
    for item in transcript.get("segments") or []:
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        start_ms = max(0, round(float(item.get("startSec") or 0) * 1000))
        end_ms = max(start_ms, round(float(item.get("endSec") or 0) * 1000))
        segments.append(ContentSegment(
            # Model-authored IDs are untrusted and may repeat. Evidence identity is
            # assigned by the normalization boundary in accepted segment order.
            id=f"seg-{len(segments) + 1}", text=text,
            locator=TimeRangeLocator(startMs=start_ms, endMs=end_ms),
            digest=sha256(text.encode("utf-8")).hexdigest(),
        ))
    if not segments:
        raise ValueError("media transcription produced no evidence segments")
    duration = youtube.probe_audio_duration(body)
    if mime_type.startswith("video/"):
        segments += _visual_segments(body, duration, invocation, 0)
    return NormalizedSource(
        sourceId=source_id,
        sourceKind="video" if mime_type.startswith("video/") else "audio",
        title=title,
        mimeType=mime_type,
        contentDigest=sha256(body).hexdigest(),
        extractorVersion=f"meta-{content.model_used()}" + (
            f"+{video_understanding.video_model()}" if any(segment.locator.kind == "frame" for segment in segments) else ""
        ),
        extractedAt=datetime.now(timezone.utc),
        segments=segments,
        metadata={"durationSec": duration, "language": str(transcript.get("language") or "und")},
        extractionReceiptId=receipt_id,
    )
