from pathlib import Path

import pytest

from harmonia_agent.production_media import (
    CompositionCompileError,
    MediaInspectionError,
    apply_voiceover_carve,
    compile_hyperframes_composition,
    create_deterministic_archive,
    create_delivery_previews,
    evaluate_media_quality,
    extract_verified_archive,
    finalize_media,
    inspect_media,
    repair_media,
    render_hyperframes_composition,
)


def test_compiler_emits_deterministic_hyperframes_timeline_and_grouped_voice_carve(tmp_path: Path):
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "shot.mp4").write_bytes(b"video")
    (assets / "music.mp3").write_bytes(b"music")
    (assets / "voice.wav").write_bytes(b"voice")
    plan = {
        "id": "plan-1", "durationSec": 10, "width": 1080, "height": 1920,
        "scenes": [{"id": "scene-1", "startSec": 0, "durationSec": 10, "videoPath": "assets/shot.mp4", "title": "Launch <now>"}],
        "music": {"path": "assets/music.mp3", "volume": 0.8},
        "narration": [{"id": "voice-1", "path": "assets/voice.wav", "startSec": 1, "durationSec": 6}],
    }
    manifest = compile_hyperframes_composition(plan, tmp_path)
    html = (tmp_path / "index.html").read_text()
    assert 'data-composition-id="harmonia-plan-1"' in html
    assert 'data-start="0" data-width="1080" data-height="1920" data-duration="10"' in html
    assert 'data-audio-group="voiceover"' in html
    assert 'data-fx-carve=' in html and '&quot;voiceover&quot;' in html
    assert "Launch &lt;now&gt;" in html
    assert "font:700 clamp(24px,6vw,64px)/1.05" in html
    assert "overflow-wrap:anywhere" in html
    assert "background:rgba(7,11,20,.92)" in html
    assert manifest["inputs"] == ["assets/music.mp3", "assets/shot.mp4", "assets/voice.wav"]
    assert manifest["voiceoverCarve"]["sources"] == ["voiceover"]


def test_compiler_emits_repeated_source_cuts_with_speech_captions_and_reframing(tmp_path: Path):
    assets = tmp_path / "assets"
    assets.mkdir()
    (assets / "interview.mp4").write_bytes(b"video")
    plan = {
        "id": "founder-reel", "durationSec": 12, "width": 1080, "height": 1920,
        "scenes": [
            {
                "id": "source-1", "startSec": 0, "durationSec": 5,
                "videoPath": "assets/interview.mp4", "mediaStartSec": 120.5,
                "preserveSourceAudio": True,
                "reframe": {"xPercent": 48, "yPercent": 40, "scale": 1.4},
                "captions": [{
                    "id": "caption-a", "startSec": 0.25, "durationSec": 2.5,
                    "text": "Build the thing that matters.",
                }],
            },
            {
                "id": "source-2", "startSec": 5, "durationSec": 7,
                "videoPath": "assets/interview.mp4", "mediaStartSec": 355,
                "preserveSourceAudio": True,
                "reframe": {"xPercent": 52, "yPercent": 44, "scale": 1.25},
                "captions": [{
                    "id": "caption-b", "startSec": 1, "durationSec": 3,
                    "text": "Meaning stays with the speaker.",
                }],
            },
        ],
        "narration": [],
    }

    manifest = compile_hyperframes_composition(plan, tmp_path)
    document = (tmp_path / "index.html").read_text()

    assert document.count('src="assets/interview.mp4"') == 2
    assert 'data-media-start="120.5"' in document
    assert 'data-media-start="355"' in document
    assert 'object-position:48% 40%;transform:scale(1.4)' in document
    assert 'object-position:52% 44%;transform:scale(1.25)' in document
    assert 'id="hf-founder-reel-source-1-video"' in document
    assert 'id="hf-founder-reel-source-1-video" class="clip"' in document
    source_one = document.split('id="hf-founder-reel-source-1-video"', 1)[1].split("</video>", 1)[0]
    assert " muted" not in source_one
    assert 'id="hf-founder-reel-caption-a"' in document
    assert 'data-start="0.25" data-duration="2.5"' in document
    assert "Build the thing that matters." in document
    assert manifest["inputs"] == ["assets/interview.mp4"]


def test_compiler_rejects_caption_or_media_window_outside_scene(tmp_path: Path):
    (tmp_path / "interview.mp4").write_bytes(b"video")
    with pytest.raises(CompositionCompileError, match="caption.*scene"):
        compile_hyperframes_composition({
            "id": "reel", "durationSec": 4, "width": 1080, "height": 1920,
            "scenes": [{
                "id": "source-1", "startSec": 0, "durationSec": 4,
                "videoPath": "interview.mp4", "mediaStartSec": 10,
                "preserveSourceAudio": True,
                "reframe": {"xPercent": 50, "yPercent": 50, "scale": 1},
                "captions": [{"id": "late", "startSec": 3, "durationSec": 2, "text": "late"}],
            }],
            "narration": [],
        }, tmp_path)


def test_compiler_rejects_paths_outside_its_workspace(tmp_path: Path):
    with pytest.raises(CompositionCompileError, match="workspace"):
        compile_hyperframes_composition({
            "id": "plan-1", "durationSec": 4, "width": 1080, "height": 1920,
            "scenes": [{"id": "scene-1", "startSec": 0, "durationSec": 4, "videoPath": "../secret.mp4"}],
            "narration": [],
        }, tmp_path)


def test_compiler_rejects_untrusted_scene_ids_before_html_generation(tmp_path: Path):
    (tmp_path / "shot.mp4").write_bytes(b"video")
    with pytest.raises(CompositionCompileError, match="scene id"):
        compile_hyperframes_composition({
            "id": "plan-1", "durationSec": 4, "width": 1080, "height": 1920,
            "scenes": [{
                "id": 'scene\" onload=\"alert(1)', "startSec": 0, "durationSec": 4,
                "videoPath": "shot.mp4",
            }],
            "narration": [],
        }, tmp_path)


def test_compiler_rejects_narration_outside_composition_timeline(tmp_path: Path):
    (tmp_path / "shot.mp4").write_bytes(b"video")
    (tmp_path / "voice.wav").write_bytes(b"voice")
    with pytest.raises(CompositionCompileError, match="narration.*timeline"):
        compile_hyperframes_composition({
            "id": "plan-1", "durationSec": 4, "width": 1080, "height": 1920,
            "scenes": [{
                "id": "scene-1", "startSec": 0, "durationSec": 4,
                "videoPath": "shot.mp4",
            }],
            "narration": [{
                "id": "voice-1", "path": "voice.wav", "startSec": 3,
                "durationSec": 2,
            }],
        }, tmp_path)


def test_ffprobe_inspection_reads_real_stream_metadata(tmp_path: Path):
    # This is a real deterministic media check, not a simulated provider output.
    import subprocess

    output = tmp_path / "sample.mp4"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=24:d=1",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(output),
    ], check=True)
    result = inspect_media(output)
    assert result["durationSec"] == pytest.approx(1, abs=0.1)
    assert result["video"] == {"codec": "h264", "width": 320, "height": 240, "frameRate": 24.0}
    assert result["audio"]["sampleRate"] == 48000
    assert result["sha256"] and len(result["sha256"]) == 64


def test_renderer_checks_before_high_quality_render_without_a_shell(tmp_path: Path):
    (tmp_path / "index.html").write_text("<html></html>")
    vendor_source = tmp_path / "source-gsap.js"
    vendor_source.write_text("window.gsap={};")
    command_log = tmp_path / "commands.txt"
    fake = tmp_path / "fake-hyperframes"
    fake.write_text(
        "#!/bin/sh\n"
        f"printf '%s\\n' \"$*\" >> '{command_log}'\n"
        "if [ \"$1\" = render ]; then while [ $# -gt 0 ]; do "
        "if [ \"$1\" = --output ]; then shift; printf video > \"$1\"; fi; shift; done; fi\n"
    )
    fake.chmod(0o755)
    output = render_hyperframes_composition(
        tmp_path, tmp_path / "out.mp4", executable=str(fake), gsap_source=vendor_source,
    )
    assert output.read_bytes() == b"video"
    assert command_log.read_text().splitlines() == [
        "check --strict", "render --quality high --output " + str(output),
    ]
    assert (tmp_path / "vendor" / "gsap.min.js").read_text() == "window.gsap={};"


def test_voiceover_carve_runs_analysis_and_requires_render_attributes(tmp_path: Path):
    (tmp_path / "index.html").write_text(
        '<audio id="music" data-fx-carve="{}"></audio>', encoding="utf-8"
    )
    fake = tmp_path / "fake-node"
    fake.write_text(
        "#!/bin/sh\n"
        "python3 -c 'from pathlib import Path; p=Path(\"index.html\"); s=p.read_text(); "
        "p.write_text(s.replace(\" data-fx-carve=\\\"{}\\\"\", "
        "\" data-fx-carve=\\\"{}\\\" data-fx-chain=\\\"{}\\\" data-automation=\\\"{}\\\"\"))'\n"
    )
    fake.chmod(0o755)
    script = tmp_path / "carve.mjs"
    script.write_text("// test")

    result = apply_voiceover_carve(
        tmp_path, executable=str(fake), script=script, core_dir=tmp_path
    )

    assert result["applied"] is True
    assert "data-fx-chain=" in (tmp_path / "index.html").read_text()
    assert "data-automation=" in (tmp_path / "index.html").read_text()


def test_composition_archive_is_deterministic_and_rejects_traversal(tmp_path: Path):
    import io
    import zipfile

    workspace = tmp_path / "workspace"
    workspace.mkdir()
    (workspace / "index.html").write_text("<html>safe</html>")
    (workspace / "asset.bin").write_bytes(b"asset")
    first = create_deterministic_archive(workspace)
    second = create_deterministic_archive(workspace)
    assert first == second
    extracted = tmp_path / "extracted"
    extract_verified_archive(first, extracted)
    assert (extracted / "index.html").read_text() == "<html>safe</html>"

    malicious = io.BytesIO()
    with zipfile.ZipFile(malicious, "w") as archive:
        archive.writestr("../escape.txt", "no")
    with pytest.raises(CompositionCompileError, match="archive path"):
        extract_verified_archive(malicious.getvalue(), tmp_path / "malicious")


def test_ffmpeg_finalization_and_qa_enforce_delivery_shape(tmp_path: Path):
    import subprocess

    source = tmp_path / "source.mp4"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=24:d=1",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", str(source),
    ], check=True)
    finalized = finalize_media(source, tmp_path / "final.mp4", width=270, height=480, frame_rate=30)
    inspection = inspect_media(finalized)
    assert inspection["video"] == {"codec": "h264", "width": 270, "height": 480, "frameRate": 30.0}
    assert inspection["audio"]["sampleRate"] == 48000
    assert inspection["audio"]["channels"] == 2
    assert inspection["audioAnalysis"]["integratedLufs"] == pytest.approx(-16, abs=1.0)
    assert inspection["audioAnalysis"]["truePeakDbfs"] <= -1.0
    assert inspection["audioAnalysis"]["silenceRatio"] == pytest.approx(0, abs=0.01)
    qa = evaluate_media_quality(inspection, {
        "durationSec": 1, "width": 270, "height": 480, "frameRate": 30,
    })
    assert qa["passed"] is True
    assert qa["issues"] == []


def test_qa_rejects_unmeasured_or_unsafe_audio():
    target = {"durationSec": 4, "width": 1080, "height": 1920, "frameRate": 30}
    base = {
        "sha256": "a" * 64,
        "bytes": 100,
        "durationSec": 4,
        "video": {"codec": "h264", "width": 1080, "height": 1920, "frameRate": 30},
        "audio": {"codec": "aac", "sampleRate": 48000, "channels": 2},
    }
    missing = evaluate_media_quality(base, target)
    unsafe = evaluate_media_quality({
        **base,
        "audioAnalysis": {"integratedLufs": -8.0, "truePeakDbfs": 0.0, "silenceRatio": 0.75},
    }, target)

    assert missing["passed"] is False
    assert "audio_analysis_missing" in missing["issues"]
    assert set(unsafe["issues"]) >= {
        "integrated_loudness_out_of_range", "true_peak_too_high", "excessive_silence",
    }


def test_deterministic_repair_normalizes_only_cost_free_delivery_defects(tmp_path: Path):
    import subprocess

    source = tmp_path / "source.mp4"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "color=c=blue:s=320x240:r=24:d=1",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=1",
        "-c:v", "libx264", "-c:a", "aac", str(source),
    ], check=True)
    target = {"durationSec": 1, "width": 270, "height": 480, "frameRate": 30}
    repaired, receipt = repair_media(
        source, tmp_path / "repaired.mp4", target=target,
        issues=["video_dimensions_mismatch", "frame_rate_mismatch", "audio_sample_rate_mismatch"],
    )

    assert receipt["attempt"] == 1
    assert receipt["qa"]["passed"] is True
    assert inspect_media(repaired)["video"]["width"] == 270
    with pytest.raises(MediaInspectionError, match="not deterministically repairable"):
        repair_media(source, tmp_path / "bad.mp4", target=target, issues=["excessive_silence"])


def test_delivery_previews_are_real_jpeg_artifacts(tmp_path: Path):
    import subprocess

    source = tmp_path / "source.mp4"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=s=320x240:r=24:d=2",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(source),
    ], check=True)
    thumbnail, contact_sheet = create_delivery_previews(
        source, tmp_path / "thumbnail.jpg", tmp_path / "contact-sheet.jpg",
    )

    assert thumbnail.read_bytes().startswith(b"\xff\xd8\xff")
    assert contact_sheet.read_bytes().startswith(b"\xff\xd8\xff")
    assert thumbnail.stat().st_size > 1000
    assert contact_sheet.stat().st_size > 1000
