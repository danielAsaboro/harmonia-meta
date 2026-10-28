"""Fail-closed extraction estimates computed before any model invocation."""

from __future__ import annotations

import json
import subprocess
import tempfile
from decimal import Decimal
from pathlib import Path

from pydantic import BaseModel, ConfigDict, Field

SUPPORTED_DOCUMENT_MIMES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


class ExtractionLimits(BaseModel):
    model_config = ConfigDict(extra="forbid")
    maximum_bytes: int = Field(gt=0)
    maximum_characters: int = Field(gt=0)
    maximum_media_duration_seconds: int = Field(gt=0)
    maximum_cost_usd: Decimal = Field(gt=0)


class ExtractionEstimate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    bytes: int
    characters_upper_bound: int
    media_duration_seconds: float
    estimated_cost_usd: Decimal


def _media_duration(body: bytes, mime_type: str) -> float:
    suffix = ".mp4" if mime_type.startswith("video/") else ".audio"
    with tempfile.NamedTemporaryFile(suffix=suffix) as source:
        source.write(body)
        source.flush()
        result = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", source.name],
            capture_output=True,
            check=False,
            text=True,
            timeout=30,
        )
    if result.returncode != 0:
        raise ValueError("media duration cannot be measured before extraction")
    try:
        duration = float(json.loads(result.stdout)["format"]["duration"])
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError("media duration cannot be measured before extraction") from exc
    if duration <= 0:
        raise ValueError("media duration cannot be measured before extraction")
    return duration


def estimate_extraction(body: bytes, mime_type: str, limits: ExtractionLimits) -> ExtractionEstimate:
    mime = mime_type.split(";", 1)[0].lower()
    if not (mime.startswith("text/") or mime.startswith(("audio/", "video/")) or mime in SUPPORTED_DOCUMENT_MIMES):
        raise ValueError(f"unsupported library source type: {mime}")
    if not body or len(body) > limits.maximum_bytes:
        raise ValueError("library source exceeds byte policy")
    duration = _media_duration(body, mime) if mime.startswith(("audio/", "video/")) else 0.0
    if duration > limits.maximum_media_duration_seconds:
        raise ValueError("library source exceeds media duration policy")
    # UTF-8 text can expand to at most one character per byte. Documents are
    # bounded conservatively because compressed containers can expand heavily.
    characters = len(body) if mime.startswith("text/") else len(body) * 20
    if characters > limits.maximum_characters:
        raise ValueError("library source exceeds extracted-character policy")
    # Conservative reservation: media seconds plus byte-derived text tokens.
    cost = (Decimal(len(body)) / Decimal(4_000_000) + Decimal(str(duration)) / Decimal(3_600)) * Decimal("0.10")
    cost = max(cost.quantize(Decimal("0.000001")), Decimal("0.000001"))
    if cost > limits.maximum_cost_usd:
        raise ValueError("library source exceeds extraction cost policy")
    return ExtractionEstimate(bytes=len(body), characters_upper_bound=characters, media_duration_seconds=duration, estimated_cost_usd=cost)
