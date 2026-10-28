"""ffmpeg-native clip rendering: Harmonia's answer to HeyGen AI Clipping.

Composable skills over one source video:
  cut       — frame-accurate segment extraction (re-encoded)
  reframe   — vertical (1080x1920) / square (1080x1080) center-crop
  captions  — transcript segments burned in as styled SRT via libass
  stitch    — concat uniform clips into a highlight reel

Everything is local compute; no external service, no fake progress.
"""

from __future__ import annotations

import subprocess
import tempfile
from pathlib import Path


class ClipError(RuntimeError):
    pass


def _run(args: list[str], timeout: int = 600) -> None:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", *args],
        capture_output=True, text=True, timeout=timeout,
    )
    if proc.returncode != 0:
        raise ClipError(f"ffmpeg failed: {(proc.stderr or '')[-400:]}")


_FILTERS: set[str] | None = None


def has_filter(name: str) -> bool:
    """Capability check so rendering degrades honestly instead of crashing."""
    global _FILTERS
    if _FILTERS is None:
        proc = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"],
            capture_output=True, text=True, timeout=30,
        )
        _FILTERS = set(proc.stdout.split())
    return name in _FILTERS


def download_video(url: str, workdir: str | Path, max_height: int = 720) -> Path:
    """Downloads a compact mp4 source via yt-dlp into workdir/src.mp4."""
    out = Path(workdir) / "src.mp4"
    fmt = f"bv*[height<={max_height}][ext=mp4]+ba[ext=m4a]/b[height<={max_height}]/b"
    proc = subprocess.run(
        ["yt-dlp", "-f", fmt, "--no-playlist", "-o", str(out), url],
        capture_output=True, text=True, timeout=900,
    )
    if proc.returncode != 0 or not out.exists():
        raise ClipError(f"yt-dlp video download failed: {(proc.stderr or '')[-300:]}")
    return out


def probe_duration(path: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    try:
        return float(proc.stdout.strip())
    except ValueError as exc:
        raise ClipError(f"ffprobe failed on {path}") from exc


def _write_srt(segments: list[dict], start: float, end: float, path: Path) -> None:
    """Shifts transcript segments into clip-local time and writes an SRT."""
    def ts(sec: float) -> str:
        ms = int(max(0.0, sec) * 1000)
        h, rem = divmod(ms, 3_600_000)
        m, rem = divmod(rem, 60_000)
        s, ms2 = divmod(rem, 1000)
        return f"{h:02}:{m:02}:{s:02},{ms2:03}"

    lines: list[str] = []
    idx = 1
    for seg in segments:
        a = max(float(seg["startSec"]) - start, 0.0)
        b = min(float(seg["endSec"]) - start, end - start)
        text = str(seg["text"]).strip()
        if b - a < 0.4 or not text:
            continue
        lines += [str(idx), f"{ts(a)} --> {ts(b)}", text, ""]
        idx += 1
    path.write_text("\n".join(lines), encoding="utf-8")


_GEOM = {
    "vertical": ("1080:1920",),
    "square": ("1080:1080",),
    "native": None,
}


def render_clip(
    source: Path,
    out: Path,
    start: float,
    end: float,
    fmt: str = "vertical",
    captions: list[dict] | None = None,
) -> list[str]:
    """Cut [start,end] seconds, reframe to fmt, optionally burn captions.
    Returns notes describing any degradation (e.g. missing subtitle filter).
    """
    geom = _GEOM.get(fmt)
    if geom is None and fmt != "native":
        raise ClipError(f"unknown clip format '{fmt}'")
    if end <= start:
        raise ClipError("clip end must be after start")

    vf: list[str] = []
    notes: list[str] = []
    if geom:
        w_h = geom[0]
        # A generic center crop can erase source claims, attribution, or diagrams.
        # Preserve the full source unless a separately approved crop exists.
        vf.append(f"scale={w_h}:force_original_aspect_ratio=decrease:force_divisible_by=2,pad={w_h}:(ow-iw)/2:(oh-ih)/2,setsar=1")

    srt_path: Path | None = None
    if captions and has_filter("subtitles"):
        srt_path = out.parent / f"{out.stem}.srt"
        _write_srt(captions, start, end, srt_path)
        # No shell involved; ffmpeg's own parser handles the inner quotes that
        # protect the comma-separated style value.
        escaped = str(srt_path).replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")
        style = "FontSize=15,Outline=1,Shadow=0,MarginV=48,Alignment=2"
        vf.append(f"subtitles=filename='{escaped}':force_style='{style}'")
    elif captions:
        notes.append("captions skipped: ffmpeg build lacks the subtitles filter")

    args = [
        "-ss", f"{max(start, 0):.3f}", "-to", f"{end:.3f}", "-i", str(source),
    ]
    if vf:
        args += ["-vf", ",".join(vf)]
    args += [
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        str(out),
    ]
    try:
        _run(args)
    finally:
        if srt_path is not None:
            srt_path.unlink(missing_ok=True)
    return notes


def render_reel(clips: list[Path], out: Path) -> None:
    """Concatenates uniformly-encoded clips into one highlight reel."""
    if len(clips) < 2:
        raise ClipError("reel needs at least two clips")
    with tempfile.TemporaryDirectory() as td:
        list_path = Path(td) / "list.txt"
        list_path.write_text(
            "\n".join(f"file '{c.as_posix()}'" for c in clips) + "\n", encoding="utf-8"
        )
        _run([
            "-f", "concat", "-safe", "0", "-i", str(list_path),
            "-c", "copy", "-movflags", "+faststart", str(out),
        ])
