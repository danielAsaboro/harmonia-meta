"""Audio and video normalization with real time-range evidence."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256

from .. import content, youtube
from ..agent_models import ContentSegment, NormalizedSource, TimeRangeLocator
from ..usage import InvocationContext


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
    return NormalizedSource(
        sourceId=source_id,
        sourceKind="video" if mime_type.startswith("video/") else "audio",
        title=title,
        mimeType=mime_type,
        contentDigest=sha256(body).hexdigest(),
        extractorVersion=f"meta-{content.model_used()}",
        extractedAt=datetime.now(timezone.utc),
        segments=segments,
        metadata={"durationSec": duration, "language": str(transcript.get("language") or "und")},
        extractionReceiptId=receipt_id,
    )
