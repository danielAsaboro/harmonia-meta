from decimal import Decimal

import pytest

from harmonia_agent.extraction.preflight import ExtractionLimits, estimate_extraction


def limits(**overrides):
    values = dict(maximum_bytes=1000, maximum_characters=1000, maximum_media_duration_seconds=60, maximum_cost_usd=Decimal("1.00"))
    values.update(overrides)
    return ExtractionLimits(**values)


def test_text_is_bounded_before_extraction():
    estimate = estimate_extraction(b"hello", "text/plain", limits())
    assert estimate.bytes == 5
    assert estimate.characters_upper_bound == 5
    assert estimate.estimated_cost_usd > 0


def test_rejects_declared_byte_and_character_excess():
    with pytest.raises(ValueError, match="byte policy"):
        estimate_extraction(b"large", "text/plain", limits(maximum_bytes=4))
    with pytest.raises(ValueError, match="character policy"):
        estimate_extraction(b"large", "text/plain", limits(maximum_characters=4))


def test_rejects_unsupported_mime_before_provider_call():
    with pytest.raises(ValueError, match="unsupported"):
        estimate_extraction(b"payload", "application/octet-stream", limits())


def test_media_probe_fails_closed(monkeypatch):
    class Result:
        returncode = 1
        stdout = ""
    monkeypatch.setattr("harmonia_agent.extraction.preflight.subprocess.run", lambda *args, **kwargs: Result())
    with pytest.raises(ValueError, match="cannot be measured"):
        estimate_extraction(b"media", "video/mp4", limits())


def test_media_duration_limit_is_checked_before_extraction(monkeypatch):
    class Result:
        returncode = 0
        stdout = '{"format":{"duration":"61"}}'
    monkeypatch.setattr("harmonia_agent.extraction.preflight.subprocess.run", lambda *args, **kwargs: Result())
    with pytest.raises(ValueError, match="duration policy"):
        estimate_extraction(b"media", "video/mp4", limits())
