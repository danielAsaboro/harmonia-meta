"""Rendered clips are measured, dead air is trimmed, and the better cut is kept."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

import pytest

from harmonia_agent import clip_review as review
from harmonia_agent.segmentation import SubjectCrop

ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg is not installed")


def _source(tmp_path: Path, lead: float, tone: float, trail: float) -> Path:
    """Silence, a speech-level tone, silence; over a moving test picture."""
    path = tmp_path / "source.mp4"
    total = lead + tone + trail
    subprocess.run([
        "ffmpeg", "-nostdin", "-v", "error", "-y",
        "-f", "lavfi", "-i", f"testsrc2=size=320x240:rate=25:duration={total}",
        "-f", "lavfi", "-i", f"sine=frequency=300:duration={tone}",
        "-filter_complex", f"[1:a]adelay={int(lead * 1000)},apad=whole_dur={total},volume=0.5[a]",
        "-map", "0:v", "-map", "[a]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", str(path),
    ], check=True, timeout=60)
    return path


def _renderer(source: Path):
    def render(out: Path, start: float, end: float) -> list[str]:
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-ss", f"{start:.3f}", "-to", f"{end:.3f}", "-i", str(source),
                        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(out)], check=True, timeout=60)
        return []
    return render


@ffmpeg
def test_dead_air_at_both_edges_is_measured_trimmed_and_the_fixed_cut_kept(tmp_path: Path):
    source = _source(tmp_path, lead=1.5, tone=4.0, trail=1.5)

    path, notes, result = review.render_reviewed(_renderer(source), tmp_path, "clip", 0.0, 7.0)

    first, second = result["versions"]
    assert {fault["code"] for fault in first["faults"]} >= {"dead_air_start", "dead_air_end"}
    assert first["passed"] is False
    assert second["passed"] is True and second["window"][0] == pytest.approx(1.35, abs=0.2)
    assert result["kept"] == 2 and path.name == "clip-v2.mp4"
    assert notes and notes[0].startswith("trimmed dead air")


@ffmpeg
def test_a_clean_cut_is_rendered_once(tmp_path: Path):
    source = _source(tmp_path, lead=0.3, tone=5.0, trail=0.3)
    renders: list[float] = []
    render = _renderer(source)

    def counted(out: Path, start: float, end: float) -> list[str]:
        renders.append(start)
        return render(out, start, end)

    _path, _notes, result = review.render_reviewed(counted, tmp_path, "clip", 0.0, 5.6)
    assert renders == [0.0] and result["kept"] == 1
    assert not any(fault["severity"] == "major" for fault in result["versions"][0]["faults"])


def test_a_fix_that_makes_things_worse_is_not_kept(tmp_path: Path):
    measurements = iter([
        review.Measurement(8.0, (review.Fault("dead_air_start", "major", 0.0, 1.0),)),
        review.Measurement(7.0, (review.Fault("black_frames", "major", 2.0, 3.0), review.Fault("long_pause", "minor", 4, 6))),
    ])
    path, notes, result = review.render_reviewed(
        lambda out, start, end: [], tmp_path, "clip", 10.0, 18.0, measure=lambda _path: next(measurements),
    )
    assert result["kept"] == 1 and path.name == "clip-v1.mp4" and notes == []
    assert result["versions"][1]["window"] == [10.85, 18.0]


def test_trim_never_leaves_a_clip_shorter_than_the_minimum():
    measurement = review.Measurement(4.0, (
        review.Fault("dead_air_start", "major", 0.0, 1.5), review.Fault("dead_air_end", "major", 2.0, 4.0),
    ))
    assert review.trimmed_window(0.0, 4.0, measurement) is None


def test_silence_parsing_closes_an_open_trailing_span():
    log = "silence_start: 0\nsilence_end: 1.2 | silence_duration: 1.2\nsilence_start: 5.4\n"
    assert review.parse_silences(log, 7.0) == [(0.0, 1.2), (5.4, 7.0)]


def test_shifted_crop_path_starts_where_the_trimmed_window_starts():
    from harmonia_agent import stages

    crop = SubjectCrop(width=608, height=1080, keyframes=((0.0, 100), (1.0, 200), (2.0, 300)))
    shifted = stages._shift_crop(crop, 1.4)
    assert shifted.keyframes == ((0.0, 200), (0.6, 300))
    assert stages._shift_crop(crop, 0.0) is crop
    assert stages._shift_crop(crop, 5.0).keyframes == ((0.0, 300),)


def test_clipped_words_widen_the_cut():
    measurement = review.Measurement(5.0, (
        review.Fault("clipped_word_start", "minor", 0.0, 0.12), review.Fault("clipped_word_end", "minor", 4.88, 5.0),
    ))
    assert review.trimmed_window(10.0, 15.0, measurement) == (9.6, 15.4)
    assert review.trimmed_window(0.1, 5.1, measurement) == (0.0, 5.5)
