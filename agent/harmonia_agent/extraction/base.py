"""Provider-neutral extraction contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..agent_models import NormalizedSource


@dataclass(frozen=True)
class ExtractionContext:
    extraction_receipt_id: str
    extracted_at: str
    maximum_bytes: int = 20 * 1024 * 1024


@dataclass(frozen=True)
class ExtractionEstimate:
    input_bytes: int
    estimated_cost_usd: str = "0.00"


@dataclass(frozen=True)
class ExtractionResult:
    normalized: NormalizedSource
    artifact_bytes: bytes | None = None


class SourceExtractor(Protocol):
    def supports(self, mime_type: str) -> bool: ...
    def extract(self, *args: object, **kwargs: object) -> NormalizedSource: ...
