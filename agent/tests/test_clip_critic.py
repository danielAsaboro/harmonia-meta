"""Muse Spark's blind clip critique is recorded as advice and never blocks a clip."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from harmonia_agent import clip_critic
from harmonia_agent.usage import InvocationContext


def _invocation() -> InvocationContext:
    return InvocationContext(job_id="job-1", workspace_id="w", brand_id="b", user_id="u", stage="publish",
                             operation_id="job-1:publish:clip-1:critic")


class _Client:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False


MEASURED = {"durationSec": 20.0, "faults": [{"code": "long_pause", "severity": "minor", "startSec": 8.0, "endSec": 9.7}]}


def test_critique_is_blind_reserved_on_counted_tokens_and_reported(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("ANALYST_MODEL_ID", raising=False)
    monkeypatch.delenv("MODEL_ID", raising=False)
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"\x00\x00\x00\x18ftypmp42")
    seen, reserved, usage = {}, [], []

    def critique(_client, model, video, prompt, before_dispatch):
        seen.update(model=model, prompt=prompt, video=video)
        before_dispatch(4000)
        return json.dumps({"score": 140, "issues": [
            {"tSec": 1.2, "criterion": "hook", "severity": "major", "note": "Opens on a pause before the claim."},
            {"tSec": 45, "criterion": "ending", "severity": "minor", "note": "Cuts before the last word."},
            {"tSec": 3, "criterion": "vibes", "severity": "minor", "note": "Not a rubric criterion."},
        ]}), {"input_tokens": 3900, "output_tokens": 300}

    result = clip_critic.critique_clip(
        clip, title="Nine days to forty hours", measured=MEASURED, invocation=_invocation(), critique=critique,
        client_factory=lambda _timeout: _Client(), budget_reserver=reserved.append,
        budget_resolver=lambda _p: pytest.fail("no resolution on success"), usage_reporter=usage.append,
    )

    assert result == {"model": "muse-spark-1.3", "score": 100, "issues": [
        {"tSec": 1.2, "criterion": "hook", "severity": "major", "note": "Opens on a pause before the claim."},
        {"tSec": 20.0, "criterion": "ending", "severity": "minor", "note": "Cuts before the last word."},
    ]}
    assert "long_pause at 8.0–9.7 s" in seen["prompt"] and "Nine days to forty hours" in seen["prompt"]
    assert reserved[0]["role"] == "clip_critic" and reserved[0]["estimatedCostUsd"] == "0.017750"
    assert (usage[0]["inputUnits"], usage[0]["outputUnits"]) == (3900, 300)


def test_no_key_means_no_critique_and_nothing_reserved(tmp_path: Path):
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"x")

    def no_key(_timeout):
        raise RuntimeError("MODEL_API_KEY is required for Muse Spark clip review")

    assert clip_critic.critique_clip(
        clip, title="t", measured=MEASURED, invocation=_invocation(), client_factory=no_key,
        budget_reserver=lambda _p: pytest.fail("must not reserve"), budget_resolver=lambda _p: pytest.fail("nothing to resolve"),
        usage_reporter=lambda _p: None,
    ) is None


def test_a_failure_after_dispatch_marks_the_reservation_uncertain(tmp_path: Path):
    clip = tmp_path / "clip.mp4"
    clip.write_bytes(b"x")
    resolved: list[dict] = []

    def critique(_client, _model, _video, _prompt, before_dispatch):
        before_dispatch(None)
        raise RuntimeError("clip critique failed (500)")

    assert clip_critic.critique_clip(
        clip, title="t", measured=MEASURED, invocation=_invocation(), critique=critique,
        client_factory=lambda _timeout: _Client(), budget_reserver=lambda _p: None,
        budget_resolver=resolved.append, usage_reporter=lambda _p: None,
    ) is None
    assert resolved[0]["outcome"] == "uncertain"


def test_schema_is_a_strict_subset():
    def visit(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node["additionalProperties"] is False and sorted(node["required"]) == sorted(node["properties"])
            for value in node.values():
                visit(value)
    visit(clip_critic.CRITIQUE_SCHEMA)
