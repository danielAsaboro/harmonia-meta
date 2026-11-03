"""Muse Spark video understanding: strict observations anchored to real frames."""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

from harmonia_agent import video_understanding as vu
from harmonia_agent.usage import InvocationContext

ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")


def _invocation() -> InvocationContext:
    return InvocationContext(
        job_id="job-1", workspace_id="w1", brand_id="b1", user_id="u1",
        stage="extract_sources", operation_id="job-1:extract_sources:source-1",
    )


def test_observation_schema_is_a_strict_subset():
    def visit(node):
        if isinstance(node, dict):
            if node.get("type") == "object":
                assert node["additionalProperties"] is False
                assert sorted(node["required"]) == sorted(node["properties"])
            for value in node.values():
                visit(value)
    visit(vu.OBSERVATION_SCHEMA)


def test_parse_keeps_in_range_ordered_spaced_observations():
    text = json.dumps({"observations": [
        {"timestampSec": 5, "observation": "Chart on screen."},
        {"timestampSec": 1, "observation": "Founder at a desk."},
        {"timestampSec": 1.2, "observation": "Same shot again."},
        {"timestampSec": 30, "observation": "Past the end."},
        {"timestampSec": 3, "observation": "  "},
    ]})
    assert vu.parse_observations(text, 10) == [(1.0, "Founder at a desk."), (5.0, "Chart on screen.")]


def test_parse_rejects_malformed_output():
    with pytest.raises(vu.VideoUnderstandingError, match="malformed"):
        vu.parse_observations("not json", 10)


@ffmpeg
def test_observe_video_anchors_each_observation_to_a_stored_frame(tmp_path: Path):
    source = tmp_path / "source.mp4"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=10:duration=4",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source)],
        check=True, timeout=60,
    )
    assert vu.has_video_stream(source)
    stored: list[bytes] = []
    reserved: list[dict] = []
    usage: list[dict] = []

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def observe(_client, model, video):
        assert model == "muse-spark-1.3" and video[4:8] == b"ftyp"
        return json.dumps({"observations": [{"timestampSec": 2, "observation": "A color test pattern."}]}), {
            "input_tokens": 1000, "output_tokens": 200,
        }

    def store(jpeg: bytes) -> str:
        stored.append(jpeg)
        return "artifact-1"

    result = vu.observe_video(
        source, 4, invocation=_invocation(), store_frame=store, observe=observe,
        client_factory=lambda _timeout: _Client(), budget_reserver=reserved.append,
        budget_resolver=lambda _payload: pytest.fail("no resolution on success"), usage_reporter=usage.append,
    )

    assert result == [(2.0, "A color test pattern.", "artifact-1")]
    assert stored[0][:3] == b"\xff\xd8\xff"
    assert reserved[0]["role"] == "video_observer"
    assert (usage[0]["inputUnits"], usage[0]["outputUnits"], usage[0]["estimatedCostUsd"]) == (1000, 200, "0.002100")


@ffmpeg
def test_observe_video_releases_the_reservation_when_nothing_was_sent(tmp_path: Path):
    resolved: list[dict] = []
    with pytest.raises(vu.VideoUnderstandingError):
        vu.observe_video(
            tmp_path / "missing.mp4", 4, invocation=_invocation(), store_frame=lambda _b: "x",
            client_factory=lambda _timeout: pytest.fail("must not dispatch"),
            budget_reserver=lambda _p: None, budget_resolver=resolved.append, usage_reporter=lambda _p: None,
        )
    assert resolved[0]["outcome"] == "not_invoked"
