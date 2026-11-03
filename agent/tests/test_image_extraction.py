"""Muse Spark image understanding turns uploaded images into citable evidence."""

from __future__ import annotations

import json

import pytest

from harmonia_agent.extraction import image
from harmonia_agent.extraction.preflight import ExtractionLimits, estimate_extraction
from harmonia_agent.usage import InvocationContext

PNG = bytes.fromhex("89504e470d0a1a0a") + b"rest-of-png"


def _invocation() -> InvocationContext:
    return InvocationContext(
        job_id="job-1", workspace_id="w1", brand_id="b1", user_id="u1",
        stage="extract_sources", operation_id="job-1:extract_sources:source-1",
    )


class _Client:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


def _extract(observe, **overrides):
    calls: dict[str, list] = {"reserve": [], "usage": [], "resolve": [], "stored": []}

    def store(body: bytes, mime: str) -> str:
        calls["stored"].append((body, mime))
        return "artifact-image-1"

    kwargs = dict(
        invocation=_invocation(), receipt_id="receipt-1", store_image=store, observe=observe,
        client_factory=lambda _timeout: _Client(), budget_reserver=calls["reserve"].append,
        budget_resolver=calls["resolve"].append, usage_reporter=calls["usage"].append,
    )
    kwargs.update(overrides)
    return image.extract_image("source-1", "pricing.png", PNG, "image/png", **kwargs), calls


def test_schema_is_a_strict_subset():
    assert image.IMAGE_SCHEMA["additionalProperties"] is False
    assert sorted(image.IMAGE_SCHEMA["required"]) == sorted(image.IMAGE_SCHEMA["properties"])


def test_image_becomes_frame_segments_backed_by_the_stored_image():
    def observe(_client, model, body, mime, before_dispatch):
        assert (model, body, mime) == ("muse-spark-1.3", PNG, "image/png")
        before_dispatch(1800)
        return json.dumps({
            "visibleText": "Pro plan $49/mo",
            "observations": ["A pricing table with three columns.", "  ", "The middle column is highlighted."],
        }), {"input_tokens": 2000, "output_tokens": 100, "input_tokens_details": {"cached_tokens": 0}}

    result, calls = _extract(observe)

    assert [segment.text for segment in result.segments] == [
        "Visible text: Pro plan $49/mo", "A pricing table with three columns.", "The middle column is highlighted.",
    ]
    assert {segment.locator.model_dump()["frameArtifactId"] for segment in result.segments} == {"artifact-image-1"}
    assert result.sourceKind == "document" and result.metadata["mediaType"] == "image"
    assert calls["stored"] == [(PNG, "image/png")]
    assert calls["reserve"][0]["role"] == "image_reader"
    # 1,800 counted input tokens plus the 4,000-token output ceiling on Muse Spark.
    assert calls["reserve"][0]["estimatedCostUsd"] == "0.019250"
    assert calls["usage"][0]["estimatedCostUsd"] == "0.002925"
    assert calls["resolve"] == []


def test_provider_failure_marks_the_reservation_uncertain_and_stores_nothing():
    calls: dict = {}

    def observe(_client, _model, _body, _mime, before_dispatch):
        before_dispatch(None)
        calls["reserved"] = True
        raise image.ImageUnderstandingError("image understanding failed (500)")

    resolved: list[dict] = []
    with pytest.raises(image.ImageUnderstandingError):
        _extract(observe, budget_resolver=resolved.append)
    assert calls["reserved"] and resolved[0]["outcome"] == "uncertain"


def test_an_uncounted_image_reserves_against_the_generous_estimate():
    def observe(_client, _model, _body, _mime, before_dispatch):
        before_dispatch(None)
        return json.dumps({"visibleText": "Hi", "observations": []}), {"input_tokens": 10, "output_tokens": 5}

    _result, calls = _extract(observe)
    assert calls["reserve"][0]["estimatedCostUsd"] == "0.020750"


def test_failure_before_the_request_is_ready_reserves_nothing():
    def observe(*_args):
        raise image.ImageUnderstandingError("client failed")

    resolved: list[dict] = []
    with pytest.raises(image.ImageUnderstandingError):
        _extract(observe, budget_reserver=lambda _p: pytest.fail("must not reserve"), budget_resolver=resolved.append)
    assert resolved == []


def test_empty_evidence_is_rejected_after_usage_is_recorded():
    def observe(_client, _model, _body, _mime, before_dispatch):
        before_dispatch(None)
        return json.dumps({"visibleText": "", "observations": []}), {}

    with pytest.raises(ValueError, match="no evidence"):
        _extract(observe)


def test_rejects_unsupported_types_before_spending():
    with pytest.raises(ValueError, match="unsupported image type"):
        image.extract_image(
            "s", "t", b"x", "image/tiff", invocation=_invocation(), receipt_id="r",
            budget_reserver=lambda _p: pytest.fail("must not reserve"),
        )


def test_preflight_accepts_images_with_a_bounded_character_estimate():
    limits = ExtractionLimits(
        maximum_bytes=30_000_000, maximum_characters=50_000,
        maximum_media_duration_seconds=600, maximum_cost_usd="1.00",
    )
    assert estimate_extraction(b"x" * 5_000_000, "image/png", limits).characters_upper_bound == 12_000
