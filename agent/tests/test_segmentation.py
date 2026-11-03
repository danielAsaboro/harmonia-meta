"""SAM 3.1 subject tracking: wire parsing, crop planning, and real ffmpeg rendering."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from harmonia_agent import clipper, segmentation
from harmonia_agent.segmentation import Box, SegmentationError, SubjectCrop, parse_boxes, plan_subject_crop
from harmonia_agent.usage import InvocationContext

ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")

# Frame 0 of the documented two-object example (docs/meta-model-api/sam/reading-segmentation.md).
DOC_LINE = (
    "<0f>0<|box;x1=211;y1=228;x2=270;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,60,~!!!!M!0c[0o91w?q1!pIH4pPRVp2B3'7`e.ioeAf6-k/#Xd8%dX9x(|>,"
    "1<|box;x1=155;y1=228;x2=202;y2=254;w=320;h=334|><|mask;x=0;y=0;data=27,48,~!!!!J!0c[q=Pj_zs=*4C4(/./x#:/`S_GnD`=o3?X{emCgO$y@|>"
)


def _invocation() -> InvocationContext:
    return InvocationContext(
        job_id="job-1", workspace_id="workspace-1", brand_id="brand-1", user_id="user-1",
        stage="publish", operation_id="job-1:publish:clip-1:m1",
    )


def _person(frame_x: int, *, object_id: int = 1, width: int = 640, height: int = 360) -> Box:
    return Box(object_id=object_id, x1=frame_x - 40, y1=60, x2=frame_x + 40, y2=340, width=width, height=height)


def test_parses_the_documented_wire_format_by_object_id_and_frame():
    frames = parse_boxes(DOC_LINE + "\n<2f>1<|box;x1=150;y1=220;x2=200;y2=250;w=320;h=334;c=0.9|><|mask;x=0;y=0;c=0.9;data=3,3,!abc|>\n")

    assert sorted(frames) == [0, 2]
    assert [box.object_id for box in frames[0]] == [0, 1]
    assert frames[0][0] == Box(object_id=0, x1=211, y1=228, x2=270, y2=254, width=320, height=334)
    assert frames[2][0].x1 == 150


def test_empty_output_is_a_valid_zero_match_result():
    assert parse_boxes("") == {}


def test_rejects_a_line_without_a_frame_marker():
    with pytest.raises(SegmentationError, match="frame marker"):
        parse_boxes("0<|box;x1=1;y1=1;x2=2;y2=2;w=3;h=3|>")


def test_crop_follows_the_dominant_subject_and_ignores_small_jitter():
    frames = {
        0: [_person(160), _person(600, object_id=2, width=640)],
        1: [_person(162)],
        5: [_person(480)],
        6: [_person(482)],
    }
    frames[0][1] = Box(object_id=2, x1=600, y1=300, x2=610, y2=310, width=640, height=360)

    crop = plan_subject_crop(frames, fps=5, source_width=1920, source_height=1080, aspect=9 / 16)

    assert crop is not None
    assert (crop.width, crop.height) == (606, 1080)
    # Proxy centers 160-162 map to source 480-486; the crop pans to center 1443.
    assert crop.keyframes == ((0.0, 180), (1.0, 1140))


def test_crop_is_clamped_inside_the_frame():
    crop = plan_subject_crop({0: [_person(10)]}, fps=5, source_width=1920, source_height=1080, aspect=1.0)
    assert crop is not None
    assert crop.keyframes == ((0.0, 0),)


def test_no_crop_when_the_aspect_already_fits_or_nothing_was_tracked():
    assert plan_subject_crop({0: [_person(100)]}, fps=5, source_width=600, source_height=1080, aspect=9 / 16) is None
    assert plan_subject_crop({}, fps=5, source_width=1920, source_height=1080, aspect=9 / 16) is None


def test_crop_expression_interpolates_between_keyframes():
    crop = SubjectCrop(width=606, height=1080, keyframes=((0.0, 100), (1.0, 300), (2.0, 300)))
    assert crop.x_expression() == (
        "if(lt(t,0.00),100,if(lt(t,1.00),100+(200)*(t-0.00)/1.00,if(lt(t,2.00),300,300)))"
    )
    assert crop.filter().startswith("crop=606:1080:x='if(")


def _video(path: Path, seconds: int = 3) -> Path:
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-y", "-f", "lavfi", "-i", f"testsrc=size=640x360:rate=10:duration={seconds}",
         "-c:v", "libx264", "-pix_fmt", "yuv420p", str(path)],
        check=True, timeout=60,
    )
    return path


@ffmpeg
def test_tracked_crop_renders_a_real_vertical_clip(tmp_path: Path):
    source = _video(tmp_path / "source.mp4")
    crop = SubjectCrop(width=202, height=360, keyframes=((0.0, 50), (1.0, 300)))

    clipper.render_clip(source, tmp_path / "out.mp4", 0, 2, fmt="vertical", crop=crop)

    assert clipper.probe_dimensions(tmp_path / "out.mp4") == (1080, 1920)


@ffmpeg
def test_track_subject_crop_reserves_budget_reports_frames_and_plans_a_crop(tmp_path: Path):
    source = _video(tmp_path / "source.mp4")
    calls: dict[str, list] = {"reserve": [], "usage": [], "segment": []}

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def segment(_client, model, subject, video):
        calls["segment"].append((model, subject, video[:4]))
        lines = [f"<{i}f>3<|box;x1=400;y1=40;x2=480;y2=340;w=640;h=360|><|mask;x=0;y=0;data=1,1,!a|>" for i in range(10)]
        return "\n".join(lines), 75

    crop = segmentation.track_subject_crop(
        source, start=0, end=2, source_width=640, source_height=360, aspect=9 / 16,
        subject="person", invocation=_invocation(), segment=segment,
        client_factory=lambda _timeout: _Client(),
        budget_reserver=calls["reserve"].append, budget_resolver=lambda _p: pytest.fail("no resolution on success"),
        usage_reporter=calls["usage"].append,
    )

    assert crop == SubjectCrop(width=202, height=360, keyframes=((0.0, 339),))
    assert calls["segment"][0][:2] == ("sam-3.1", "person")
    assert calls["reserve"][0]["role"] == "segmenter"
    assert calls["reserve"][0]["estimatedCostUsd"] == "0.010000"
    usage = calls["usage"][0]
    assert (usage["unitType"], usage["inputUnits"], usage["estimatedCostUsd"]) == ("video_frames", 75, "0.015000")


@ffmpeg
def test_track_subject_crop_resolves_budget_as_uncertain_after_a_provider_failure(tmp_path: Path):
    source = _video(tmp_path / "source.mp4")
    resolved = []

    class _Client:
        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def segment(*_args):
        raise SegmentationError("SAM request failed (500)")

    with pytest.raises(SegmentationError):
        segmentation.track_subject_crop(
            source, start=0, end=2, source_width=640, source_height=360, aspect=9 / 16,
            subject="person", invocation=_invocation(), segment=segment,
            client_factory=lambda _timeout: _Client(), budget_reserver=lambda _p: None,
            budget_resolver=resolved.append, usage_reporter=lambda _p: None,
        )

    assert resolved[0]["outcome"] == "uncertain"


def test_stage_keeps_the_full_frame_when_tracking_fails_or_is_declined(monkeypatch):
    from harmonia_agent import stages

    job = {"id": "job-1", "workspaceId": "w1", "brandId": "b1", "createdByUserId": "u1"}
    monkeypatch.setattr(stages.clipper, "probe_dimensions", lambda _src: (1920, 1080))

    def fail(*_args, **_kwargs):
        raise RuntimeError("MODEL_API_KEY is required for SAM 3.1 segmentation")

    monkeypatch.setattr(stages.segmentation, "track_subject_crop", fail)
    action = {"id": "clip-1", "payload": {"momentId": "m1"}}
    assert stages._subject_crop(job, action, Path("s.mp4"), 0, 5, "vertical", "m1") == (
        None, ["subject tracking unavailable; kept the full frame"],
    )
    declined = {"id": "clip-1", "payload": {"momentId": "m1", "reframe": "none"}}
    assert stages._subject_crop(job, declined, Path("s.mp4"), 0, 5, "vertical", "m1") == (None, [])
    assert stages._subject_crop(job, action, Path("s.mp4"), 0, 5, "native", "m1") == (None, [])


def test_stage_passes_the_requested_subject_and_a_per_moment_operation(monkeypatch):
    from harmonia_agent import stages

    seen = {}
    monkeypatch.setattr(stages.clipper, "probe_dimensions", lambda _src: (1920, 1080))

    def track(_source, **kwargs):
        seen.update(kwargs)
        return SubjectCrop(width=1080, height=1080, keyframes=((0.0, 420),))

    monkeypatch.setattr(stages.segmentation, "track_subject_crop", track)
    job = {"id": "job-1", "workspaceId": "w1", "brandId": "b1", "createdByUserId": "u1"}
    crop, notes = stages._subject_crop(
        job, {"id": "reel-1", "payload": {"subject": "guitar"}}, Path("s.mp4"), 3, 9, "square", "m2",
    )

    assert crop is not None and notes == ["reframed to follow the tracked guitar (SAM 3.1)"]
    assert (seen["subject"], seen["aspect"], seen["start"], seen["end"]) == ("guitar", 1.0, 3, 9)
    assert seen["invocation"].operation_id == "job-1:publish:reel-1:m2"
