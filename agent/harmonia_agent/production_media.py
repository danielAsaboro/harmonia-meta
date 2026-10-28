"""Deterministic composition compilation and real media inspection."""

from __future__ import annotations

import hashlib
import html
import io
import json
import re
import shutil
import subprocess
from pathlib import Path
from typing import Any
import zipfile


class CompositionCompileError(ValueError):
    """A production plan cannot be compiled safely."""


class MediaInspectionError(RuntimeError):
    """ffprobe could not establish the integrity of a media artifact."""


def create_deterministic_archive(workspace: Path) -> bytes:
    """Freeze a composition workspace without timestamps, symlinks, or path ambiguity."""
    root = workspace.resolve()
    if not root.is_dir():
        raise CompositionCompileError("composition workspace is missing")
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(root.rglob("*"), key=lambda value: value.relative_to(root).as_posix()):
            if path.is_symlink():
                raise CompositionCompileError("composition archive cannot contain symlinks")
            if not path.is_file():
                continue
            relative = path.relative_to(root).as_posix()
            info = zipfile.ZipInfo(relative, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o100644 << 16
            archive.writestr(info, path.read_bytes())
    return output.getvalue()


def extract_verified_archive(data: bytes, destination: Path) -> list[str]:
    """Extract only bounded regular files beneath the selected workspace."""
    root = destination.resolve()
    root.mkdir(parents=True, exist_ok=True)
    try:
        archive = zipfile.ZipFile(io.BytesIO(data), "r")
    except zipfile.BadZipFile as exc:
        raise CompositionCompileError("composition archive is malformed") from exc
    names: list[str] = []
    total = 0
    with archive:
        entries = archive.infolist()
        if not entries or len(entries) > 500:
            raise CompositionCompileError("composition archive file count is invalid")
        for entry in entries:
            relative = Path(entry.filename)
            target = (root / relative).resolve()
            if relative.is_absolute() or ".." in relative.parts or (target != root and root not in target.parents):
                raise CompositionCompileError("composition archive path escapes its workspace")
            if entry.is_dir():
                continue
            total += entry.file_size
            if total > 1024 * 1024 * 1024:
                raise CompositionCompileError("composition archive expands beyond its size limit")
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(archive.read(entry))
            names.append(relative.as_posix())
    return names


def _number(value: Any, name: str, *, minimum: float = 0) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or value < minimum:
        raise CompositionCompileError(f"{name} must be a number >= {minimum}")
    return float(value)


def _safe_id(value: Any, name: str) -> str:
    identifier = str(value or "")
    if not identifier or len(identifier) > 128 or not all(
        character.isalnum() or character in "-_" for character in identifier
    ):
        raise CompositionCompileError(f"{name} must contain only letters, numbers, hyphens, and underscores")
    return identifier


def _media_path(workspace: Path, raw: Any) -> str:
    if not isinstance(raw, str) or not raw:
        raise CompositionCompileError("media path is required")
    root = workspace.resolve()
    resolved = (workspace / raw).resolve()
    if resolved != root and root not in resolved.parents:
        raise CompositionCompileError("media path must remain inside the composition workspace")
    if not resolved.is_file():
        raise CompositionCompileError(f"media path does not exist inside the workspace: {raw}")
    return resolved.relative_to(root).as_posix()


def _attr_json(value: Any) -> str:
    return html.escape(json.dumps(value, sort_keys=True, separators=(",", ":")), quote=True)


def compile_hyperframes_composition(plan: dict[str, Any], workspace: Path) -> dict[str, Any]:
    """Compile a constrained plan to standalone HyperFrames HTML and a manifest."""
    workspace.mkdir(parents=True, exist_ok=True)
    plan_id = str(plan.get("id") or "").strip()
    if not plan_id or not all(ch.isalnum() or ch in "-_" for ch in plan_id):
        raise CompositionCompileError("plan id must be filesystem and DOM safe")
    duration = _number(plan.get("durationSec"), "durationSec", minimum=0.01)
    width = int(_number(plan.get("width"), "width", minimum=1))
    height = int(_number(plan.get("height"), "height", minimum=1))
    scenes = plan.get("scenes")
    if not isinstance(scenes, list) or not scenes:
        raise CompositionCompileError("at least one scene is required")

    inputs: set[str] = set()
    scene_markup: list[str] = []
    for index, scene in enumerate(scenes):
        if not isinstance(scene, dict):
            raise CompositionCompileError("scene must be an object")
        scene_id = _safe_id(scene.get("id") or f"scene-{index + 1}", "scene id")
        start = _number(scene.get("startSec"), "scene.startSec")
        scene_duration = _number(scene.get("durationSec"), "scene.durationSec", minimum=0.01)
        if start + scene_duration > duration + 0.001:
            raise CompositionCompileError("scene extends beyond composition duration")
        source = _media_path(workspace, scene.get("videoPath"))
        inputs.add(source)
        title = html.escape(str(scene.get("title") or ""))
        media_start = _number(scene.get("mediaStartSec", 0), "scene.mediaStartSec")
        preserve_source_audio = scene.get("preserveSourceAudio", False)
        if not isinstance(preserve_source_audio, bool):
            raise CompositionCompileError("scene.preserveSourceAudio must be a boolean")
        reframe = scene.get("reframe") or {"xPercent": 50, "yPercent": 50, "scale": 1}
        if not isinstance(reframe, dict):
            raise CompositionCompileError("scene.reframe must be an object")
        x_percent = _number(reframe.get("xPercent"), "scene.reframe.xPercent")
        y_percent = _number(reframe.get("yPercent"), "scene.reframe.yPercent")
        scale = _number(reframe.get("scale"), "scene.reframe.scale", minimum=1)
        if x_percent > 100 or y_percent > 100 or scale > 4:
            raise CompositionCompileError("scene reframe is outside its supported range")
        muted = "" if preserve_source_audio else " muted"
        scene_markup.append(
            f'<video id="hf-{plan_id}-{scene_id}-video" class="clip" src="{html.escape(source, quote=True)}" '
            f'data-start="{start:g}" data-duration="{scene_duration:g}" data-media-start="{media_start:g}" '
            f'data-track-index="{index}" style="object-position:{x_percent:g}% {y_percent:g}%;transform:scale({scale:g})"'
            f'{muted} playsinline></video>'
        )
        if title:
            scene_markup.append(
                f'<section id="hf-{plan_id}-{scene_id}-title" class="clip title" data-start="{start:g}" '
                f'data-duration="{scene_duration:g}" data-track-index="{100 + index}"><h2>{title}</h2></section>'
            )
        captions = scene.get("captions") or []
        if not isinstance(captions, list):
            raise CompositionCompileError("scene.captions must be a list")
        for caption_index, caption in enumerate(captions):
            if not isinstance(caption, dict):
                raise CompositionCompileError("caption must be an object")
            caption_id = _safe_id(caption.get("id") or f"{scene_id}-caption-{caption_index + 1}", "caption id")
            caption_start = _number(caption.get("startSec"), "caption.startSec")
            caption_duration = _number(caption.get("durationSec"), "caption.durationSec", minimum=0.01)
            if caption_start + caption_duration > scene_duration + 0.001:
                raise CompositionCompileError("caption extends beyond its scene")
            caption_text = html.escape(str(caption.get("text") or "").strip())
            if not caption_text:
                raise CompositionCompileError("caption text is required")
            scene_markup.append(
                f'<section id="hf-{plan_id}-{caption_id}" class="clip caption" '
                f'data-start="{start + caption_start:g}" data-duration="{caption_duration:g}" '
                f'data-track-index="{400 + index * 100 + caption_index}"><p>{caption_text}</p></section>'
            )

    audio_markup: list[str] = []
    narration = plan.get("narration") or []
    if not isinstance(narration, list):
        raise CompositionCompileError("narration must be a list")
    for index, voice in enumerate(narration):
        source = _media_path(workspace, voice.get("path"))
        inputs.add(source)
        voice_id = _safe_id(voice.get("id") or f"voice-{index + 1}", "narration id")
        start = _number(voice.get("startSec"), "narration.startSec")
        voice_duration = _number(voice.get("durationSec"), "narration.durationSec", minimum=0.01)
        if start + voice_duration > duration + 0.001:
            raise CompositionCompileError("narration extends beyond composition timeline")
        audio_markup.append(
            f'<audio id="hf-{plan_id}-{voice_id}" src="{html.escape(source, quote=True)}" '
            f'data-start="{start:g}" data-duration="{voice_duration:g}" data-track-index="{200 + index}" '
            'data-audio-group="voiceover" data-volume="1"></audio>'
        )

    carve = None
    music = plan.get("music")
    if music is not None:
        if not isinstance(music, dict):
            raise CompositionCompileError("music must be an object")
        source = _media_path(workspace, music.get("path"))
        inputs.add(source)
        volume = _number(music.get("volume", 0.8), "music.volume")
        if volume > 1:
            raise CompositionCompileError("music.volume must be <= 1")
        carve = {"enabled": bool(narration), "sources": ["voiceover"] if narration else [], "strength": 0.25, "dynamic": True}
        carve_attribute = f' data-fx-carve="{_attr_json(carve)}"' if narration else ""
        audio_markup.append(
            f'<audio id="hf-{plan_id}-music" src="{html.escape(source, quote=True)}" data-start="0" '
            f'data-duration="{duration:g}" data-track-index="300" data-volume="{volume:g}"{carve_attribute}></audio>'
        )

    composition_id = f"harmonia-{plan_id}"
    index_html = f'''<!doctype html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width={width}, height={height}">
<title>Harmonia production {html.escape(plan_id)}</title><script src="vendor/gsap.min.js"></script>
<style>html,body{{margin:0;width:{width}px;height:{height}px;background:#070b14;color:white;overflow:hidden}}#root{{position:relative;width:{width}px;height:{height}px;overflow:hidden}}.clip{{position:absolute;inset:0;width:100%;height:100%;object-fit:cover}}.title{{display:grid;place-items:end start;padding:8%;box-sizing:border-box}}h2{{font:700 clamp(24px,6vw,64px)/1.05 Inter,system-ui,sans-serif;margin:0;max-width:100%;overflow-wrap:anywhere;background:rgba(7,11,20,.92);padding:.35em .45em;border-radius:.2em;box-sizing:border-box}}.caption{{display:grid;place-items:end center;padding:0 8% 12%;box-sizing:border-box;pointer-events:none}}.caption p{{font:800 clamp(30px,5vw,58px)/1.08 Inter,system-ui,sans-serif;text-align:center;margin:0;padding:.24em .4em;color:#fff;background:rgba(7,11,20,.88);border-radius:.18em;text-wrap:balance;text-shadow:0 2px 8px rgba(0,0,0,.8)}}</style></head>
<body><div id="root" data-composition-id="{composition_id}" data-start="0" data-width="{width}" data-height="{height}" data-duration="{duration:g}">
{''.join(scene_markup)}{''.join(audio_markup)}</div>
<script>window.__timelines=window.__timelines||{{}};const tl=gsap.timeline({{paused:true}});window.__timelines["{composition_id}"]=tl;</script></body></html>'''
    (workspace / "index.html").write_text(index_html, encoding="utf-8")
    manifest = {
        "schemaVersion": 1,
        "planId": plan_id,
        "compositionId": composition_id,
        "durationSec": duration,
        "dimensions": {"width": width, "height": height},
        "inputs": sorted(inputs),
        "voiceoverCarve": carve,
    }
    (workspace / "composition-manifest.json").write_text(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8"
    )
    return manifest


def _rate(value: str) -> float:
    numerator, _, denominator = value.partition("/")
    return float(numerator) / float(denominator or 1)


def _audio_quality(path: Path, duration: float) -> dict[str, float]:
    """Measure delivery loudness, true peak, and silence from decoded samples."""
    commands = [
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-filter_complex", "ebur128=peak=true", "-f", "null", "-"],
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(path), "-af", "silencedetect=noise=-50dB:d=0.1", "-f", "null", "-"],
    ]
    try:
        loudness = subprocess.run(commands[0], check=True, capture_output=True, text=True, timeout=120).stderr
        silence = subprocess.run(commands[1], check=True, capture_output=True, text=True, timeout=120).stderr
    except (OSError, subprocess.SubprocessError) as exc:
        raise MediaInspectionError("ffmpeg could not analyze audio quality") from exc
    integrated_match = re.search(r"Integrated loudness:\s+I:\s+(-?(?:\d+(?:\.\d+)?|inf))\s+LUFS", loudness)
    peak_match = re.search(r"True peak:\s+Peak:\s+(-?(?:\d+(?:\.\d+)?|inf))\s+dBFS", loudness)
    if not integrated_match or not peak_match:
        raise MediaInspectionError("ffmpeg audio quality summary is incomplete")

    def measured(value: str) -> float:
        return -120.0 if value == "-inf" else float(value)

    silence_duration = sum(float(value) for value in re.findall(r"silence_duration:\s*([0-9.]+)", silence))
    starts = re.findall(r"silence_start:\s*([0-9.]+)", silence)
    ends = re.findall(r"silence_end:\s*([0-9.]+)", silence)
    if len(starts) > len(ends) and duration > 0:
        silence_duration += max(0.0, duration - float(starts[-1]))
    return {
        "integratedLufs": measured(integrated_match.group(1)),
        "truePeakDbfs": measured(peak_match.group(1)),
        "silenceRatio": min(1.0, max(0.0, silence_duration / duration)) if duration > 0 else 1.0,
    }


def inspect_media(path: Path) -> dict[str, Any]:
    if not path.is_file() or path.stat().st_size == 0:
        raise MediaInspectionError("media artifact is missing or empty")
    command = [
        "ffprobe", "-v", "error", "-show_entries",
        "format=duration,size,format_name:stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate,channels",
        "-of", "json", str(path),
    ]
    try:
        completed = subprocess.run(command, check=True, capture_output=True, text=True, timeout=60)
        raw = json.loads(completed.stdout)
    except (subprocess.SubprocessError, json.JSONDecodeError) as exc:
        raise MediaInspectionError(f"ffprobe could not inspect media: {exc}") from exc
    streams = raw.get("streams") or []
    video_stream = next((item for item in streams if item.get("codec_type") == "video"), None)
    audio_streams = [item for item in streams if item.get("codec_type") == "audio"]
    video = None if video_stream is None else {
        "codec": video_stream.get("codec_name"),
        "width": int(video_stream.get("width") or 0),
        "height": int(video_stream.get("height") or 0),
        "frameRate": _rate(str(video_stream.get("avg_frame_rate") or "0/1")),
    }
    audio = [{
        "codec": item.get("codec_name"),
        "sampleRate": int(item.get("sample_rate") or 0),
        "channels": int(item.get("channels") or 0),
    } for item in audio_streams]
    duration = float((raw.get("format") or {}).get("duration") or 0)
    return {
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "bytes": path.stat().st_size,
        "durationSec": duration,
        "format": (raw.get("format") or {}).get("format_name"),
        "video": video,
        "audio": audio[0] if len(audio) == 1 else audio,
        "audioAnalysis": _audio_quality(path, duration) if audio else None,
    }


def apply_voiceover_carve(
    workspace: Path,
    *,
    executable: str = "node",
    script: Path = Path("/opt/hyperframes/scripts/apply-carve.mjs"),
    core_dir: Path = Path("/opt/hyperframes"),
) -> dict[str, Any]:
    """Analyze grouped voices and persist the render-consumed carve attributes."""
    composition = workspace / "index.html"
    if not composition.is_file() or not script.is_file():
        raise CompositionCompileError("composition or pinned carve analyzer is unavailable")
    command = [executable, str(script), "--comp", str(composition), "--core", str(core_dir)]
    try:
        completed = subprocess.run(
            command, cwd=workspace, check=True, capture_output=True, text=True, timeout=300
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise MediaInspectionError("voiceover carve analysis failed") from exc
    rendered = composition.read_text(encoding="utf-8")
    if "data-fx-chain=" not in rendered or "data-automation=" not in rendered:
        raise MediaInspectionError("carve analysis did not produce renderable effects and automation")
    try:
        details = json.loads(completed.stdout or "{}")
    except json.JSONDecodeError:
        details = {"output": completed.stdout.strip()}
    receipt = {
        "applied": True,
        **details,
        "compositionSha256": hashlib.sha256(rendered.encode("utf-8")).hexdigest(),
    }
    manifest_path = workspace / "composition-manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        manifest["voiceoverCarveAnalysis"] = receipt
        manifest_path.write_text(
            json.dumps(manifest, sort_keys=True, separators=(",", ":")), encoding="utf-8"
        )
    return receipt


def render_hyperframes_composition(
    workspace: Path,
    output: Path,
    *,
    executable: str = "hyperframes",
    gsap_source: Path = Path("/opt/hyperframes/node_modules/gsap/dist/gsap.min.js"),
    carve_script: Path = Path("/opt/hyperframes/scripts/apply-carve.mjs"),
) -> Path:
    """Validate then render a compiled project with an argv-only subprocess boundary."""
    if not (workspace / "index.html").is_file():
        raise CompositionCompileError("compiled index.html is missing")
    if not gsap_source.is_file():
        raise CompositionCompileError("pinned GSAP runtime is unavailable")
    vendor = workspace / "vendor"
    vendor.mkdir(exist_ok=True)
    shutil.copyfile(gsap_source, vendor / "gsap.min.js")
    composition_html = (workspace / "index.html").read_text(encoding="utf-8")
    if "data-fx-carve=" in composition_html and "data-fx-chain=" not in composition_html:
        apply_voiceover_carve(workspace, script=carve_script)
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    commands = [
        [executable, "check", "--strict"],
        [executable, "render", "--quality", "high", "--output", str(output)],
    ]
    for command in commands:
        try:
            subprocess.run(command, cwd=workspace, check=True, timeout=900)
        except (OSError, subprocess.SubprocessError) as exc:
            raise MediaInspectionError(f"HyperFrames command failed: {command[1]}") from exc
    if not output.is_file() or output.stat().st_size == 0:
        raise MediaInspectionError("HyperFrames reported success without a rendered artifact")
    return output


def finalize_media(
    source: Path,
    output: Path,
    *,
    width: int,
    height: int,
    frame_rate: int,
) -> Path:
    """Normalize a rendered artifact to the sealed delivery shape."""
    if width < 2 or height < 2 or width % 2 or height % 2:
        raise CompositionCompileError("delivery dimensions must be positive even integers")
    if frame_rate < 1 or frame_rate > 120:
        raise CompositionCompileError("delivery frame rate is outside the supported range")
    inspected = inspect_media(source)
    if not inspected.get("video"):
        raise MediaInspectionError("finalization input has no video stream")
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    filter_graph = (
        f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
        f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p"
    )
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-vf", filter_graph, "-r", str(frame_rate), "-c:v", "libx264", "-pix_fmt", "yuv420p",
    ]
    if inspected.get("audio"):
        command += [
            "-c:a", "aac", "-ar", "48000", "-ac", "2",
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        ]
    else:
        command += ["-an"]
    command += ["-movflags", "+faststart", str(output)]
    try:
        subprocess.run(command, check=True, timeout=900)
    except (OSError, subprocess.SubprocessError) as exc:
        raise MediaInspectionError("ffmpeg finalization failed") from exc
    inspect_media(output)
    return output


def mix_media_audio(source: Path, output: Path) -> Path:
    """Apply the deterministic delivery loudness target without changing video frames."""
    inspected = inspect_media(source)
    if not inspected.get("video"):
        raise MediaInspectionError("audio mix input has no video stream")
    output = output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    command = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source), "-c:v", "copy"]
    if inspected.get("audio"):
        command += [
            "-c:a", "aac", "-ar", "48000", "-ac", "2",
            "-af", "loudnorm=I=-16:TP=-1.5:LRA=11",
        ]
    else:
        command += ["-an"]
    command.append(str(output))
    try:
        subprocess.run(command, check=True, timeout=900)
    except (OSError, subprocess.SubprocessError) as exc:
        raise MediaInspectionError("ffmpeg audio mix failed") from exc
    inspect_media(output)
    return output


def repair_media(
    source: Path,
    output: Path,
    *,
    target: dict[str, Any],
    issues: list[str],
) -> tuple[Path, dict[str, Any]]:
    """Perform one bounded, cost-free delivery normalization repair."""
    repairable = {
        "video_codec_not_h264",
        "video_dimensions_mismatch",
        "frame_rate_mismatch",
        "audio_sample_rate_mismatch",
        "audio_channel_count_mismatch",
        "integrated_loudness_out_of_range",
        "true_peak_too_high",
    }
    unsupported = sorted(set(issues) - repairable)
    if not issues or unsupported:
        detail = ",".join(unsupported or ["no reported defect"])
        raise MediaInspectionError(f"production defect is not deterministically repairable: {detail}")
    repaired = finalize_media(
        source,
        output,
        width=int(target["width"]),
        height=int(target["height"]),
        frame_rate=int(target["frameRate"]),
    )
    inspection = inspect_media(repaired)
    qa = evaluate_media_quality(inspection, target)
    if not qa["passed"]:
        raise MediaInspectionError("deterministic production repair did not pass QA: " + ",".join(qa["issues"]))
    return repaired, {"attempt": 1, "inputIssues": sorted(set(issues)), "qa": qa}


def create_delivery_previews(
    source: Path,
    thumbnail: Path,
    contact_sheet: Path,
) -> tuple[Path, Path]:
    """Create deterministic JPEG thumbnail and four-frame contact sheet."""
    inspection = inspect_media(source)
    if not inspection.get("video"):
        raise MediaInspectionError("delivery preview input has no video stream")
    duration = float(inspection.get("durationSec") or 0)
    if duration <= 0:
        raise MediaInspectionError("delivery preview input has invalid duration")
    thumbnail.parent.mkdir(parents=True, exist_ok=True)
    contact_sheet.parent.mkdir(parents=True, exist_ok=True)
    sample_rate = 4.0 / duration
    commands = [
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-ss", f"{duration / 2:.6f}", "-i", str(source), "-frames:v", "1",
            "-vf", "scale=640:-2", "-q:v", "2", "-update", "1", str(thumbnail),
        ],
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
            "-vf", f"fps={sample_rate:.9f},scale=320:-2,tile=2x2:padding=8:margin=8",
            "-frames:v", "1", "-q:v", "2", "-update", "1", str(contact_sheet),
        ],
    ]
    try:
        for command in commands:
            subprocess.run(command, check=True, timeout=300)
    except (OSError, subprocess.SubprocessError) as exc:
        raise MediaInspectionError("ffmpeg delivery preview generation failed") from exc
    for artifact in (thumbnail, contact_sheet):
        data = artifact.read_bytes() if artifact.is_file() else b""
        if len(data) < 4 or not data.startswith(b"\xff\xd8\xff"):
            raise MediaInspectionError("ffmpeg delivery preview is not a valid JPEG")
    return thumbnail, contact_sheet


def evaluate_media_quality(inspection: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    """Apply deterministic delivery checks; failed checks never become success."""
    issues: list[str] = []
    video = inspection.get("video")
    audio = inspection.get("audio")
    audio_analysis = inspection.get("audioAnalysis")
    if not inspection.get("sha256") or not inspection.get("bytes"):
        issues.append("integrity_check_failed")
    if not isinstance(video, dict):
        issues.append("missing_video_stream")
    else:
        if video.get("codec") != "h264":
            issues.append("video_codec_not_h264")
        if video.get("width") != target.get("width") or video.get("height") != target.get("height"):
            issues.append("video_dimensions_mismatch")
        if abs(float(video.get("frameRate") or 0) - float(target.get("frameRate") or 0)) > 0.05:
            issues.append("frame_rate_mismatch")
    duration = float(inspection.get("durationSec") or 0)
    expected_duration = float(target.get("durationSec") or 0)
    if duration <= 0 or expected_duration <= 0 or abs(duration - expected_duration) > max(0.25, expected_duration * 0.02):
        issues.append("duration_mismatch")
    if audio:
        streams = audio if isinstance(audio, list) else [audio]
        if len(streams) != 1:
            issues.append("audio_stream_count_mismatch")
        else:
            if streams[0].get("sampleRate") != 48000:
                issues.append("audio_sample_rate_mismatch")
            if streams[0].get("channels") != 2:
                issues.append("audio_channel_count_mismatch")
        if not isinstance(audio_analysis, dict):
            issues.append("audio_analysis_missing")
        else:
            if not -18.0 <= float(audio_analysis.get("integratedLufs", -120)) <= -14.0:
                issues.append("integrated_loudness_out_of_range")
            if float(audio_analysis.get("truePeakDbfs", 0)) > -1.0:
                issues.append("true_peak_too_high")
            if float(audio_analysis.get("silenceRatio", 1)) > 0.5:
                issues.append("excessive_silence")
    return {
        "schemaVersion": 1,
        "passed": not issues,
        "issues": issues,
        "checks": {
            "integrity": bool(inspection.get("sha256") and inspection.get("bytes")),
            "duration": duration,
            "video": video,
            "audio": audio,
            "audioAnalysis": audio_analysis,
        },
    }
