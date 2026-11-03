import pytest
from pydantic import ValidationError

from harmonia_agent.agent_models import NormalizedSource, PageRangeLocator


def _normalized_source(segment: dict[str, object]) -> dict[str, object]:
    return {
        "sourceId": "s1",
        "sourceKind": "document",
        "title": "Brief",
        "mimeType": "application/pdf",
        "contentDigest": "a" * 64,
        "extractorVersion": "pdf-v1",
        "extractedAt": "2026-08-30T00:00:00Z",
        "extractionReceiptId": "r1",
        "metadata": {},
        "segments": [segment],
    }


def test_normalized_source_requires_locator_for_each_segment() -> None:
    with pytest.raises(ValidationError):
        NormalizedSource.model_validate(_normalized_source({
            "id": "seg-1",
            "text": "Claim",
            "digest": "b" * 64,
        }))


def test_page_locator_is_one_based_and_increasing() -> None:
    locator = PageRangeLocator(kind="page_range", startPage=1, endPage=2)
    assert locator.endPage == 2

    with pytest.raises(ValidationError):
        PageRangeLocator(kind="page_range", startPage=0, endPage=1)

    with pytest.raises(ValidationError):
        PageRangeLocator(kind="page_range", startPage=3, endPage=2)
