"""Measure every rendered clip, fix what can be fixed, and keep the better cut.

A model can say a clip looks fine while it opens on a second of silence. This
gate measures the rendered file itself with ffmpeg, so a fault counts even if
no reviewer notices it:

- ``dead_air_start`` / ``dead_air_end``: at least 0.6 s of silence at an edge
- ``black_frames``: at least 0.4 s of black picture
- ``no_audio``: the render lost its audio stream
- ``long_pause``: 1.5 s or more of silence inside the clip
- ``clipped_word_start`` / ``clipped_word_end``: speech-level audio in the first
  or last 120 ms, which usually means the cut lands mid-word

Edge faults have fixes: dead air is trimmed to the speech (padded by 150 ms)
and a clipped word widens the cut by 400 ms, then the clip is rendered once more. Both versions are measured and
the better one is kept (fewer major faults, then fewer minor ones, earliest
version on a tie), so a fix can never make the delivered clip worse. The loop
stops when nothing is fixable, the fix repeats, or ``MAX_PASSES`` is reached.
"""

from __future__ import annotations

import re
import subprocess
from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

SILENCE_DB = -35
EDGE_SILENCE_SEC = 0.6
LONG_PAUSE_SEC = 1.5
BLACK_SEC = 0.4
EDGE_PROBE_SEC = 0.12
EDGE_SPEECH_DB = -28.0
TRIM_PAD_SEC = 0.15
WORD_PAD_SEC = 0.4
MIN_CLIP_SEC = 3.0
MAX_PASSES = 2


@dataclass(frozen=True)
class Fault:
    code: str
    severity: str  # "major" or "minor"
    startSec: float
    endSec: float


@dataclass(frozen=True)
class Measurement:
    durationSec: float
    faults: tuple[Fault, ...]

    @property
    def majors(self) -> int:
        return sum(fault.severity == "major" for fault in self.faults)

    @property
    def passed(self) -> bool:
        return self.majors == 0

    def rank(self) -> tuple[int, int, int]:
        return (int(self.passed), -self.majors, -(len(self.faults) - self.majors))

    def to_wire(self) -> dict[str, Any]:
        return {"durationSec": round(self.durationSec, 2), "passed": self.passed,
                "faults": [asdict(fault) for fault in self.faults]}


def _ffmpeg_log(args: list[str], timeout: int = 300) -> str:
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", *args, "-f", "null", "-"],
        capture_output=True, text=True, timeout=timeout,
    )
    return proc.stderr or ""


def _duration(path: Path) -> float:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    return float(proc.stdout.strip() or 0)


def _has_audio(path: Path) -> bool:
    proc = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=codec_type", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, timeout=60,
    )
    return proc.stdout.strip() == "audio"


def parse_silences(log: str, duration: float) -> list[tuple[float, float]]:
    spans: list[tuple[float, float]] = []
    start: float | None = None
    for line in log.splitlines():
        if match := re.search(r"silence_start: (-?[\d.]+)", line):
            start = max(float(match.group(1)), 0.0)
        elif (match := re.search(r"silence_end: ([\d.]+)", line)) and start is not None:
            spans.append((start, float(match.group(1))))
            start = None
    if start is not None:
        spans.append((start, duration))
    return spans


def parse_blacks(log: str) -> list[tuple[float, float]]:
    return [(float(a), float(b)) for a, b in re.findall(r"black_start:([\d.]+) black_end:([\d.]+)", log)]


def _edge_volume(path: Path, start: float) -> float | None:
    log = _ffmpeg_log(["-ss", f"{max(start, 0):.3f}", "-t", f"{EDGE_PROBE_SEC}", "-i", str(path), "-vn", "-af", "volumedetect"], timeout=60)
    match = re.search(r"mean_volume: (-?[\d.]+|-inf) dB", log)
    if not match or match.group(1) == "-inf":
        return None
    return float(match.group(1))


def faults_from(
    duration: float, silences: list[tuple[float, float]], blacks: list[tuple[float, float]],
    has_audio: bool, edge_db: tuple[float | None, float | None],
) -> tuple[Fault, ...]:
    faults: list[Fault] = []
    if not has_audio:
        faults.append(Fault("no_audio", "major", 0.0, round(duration, 2)))
    for start, end in silences:
        length = end - start
        if start <= 0.05 and length >= EDGE_SILENCE_SEC:
            faults.append(Fault("dead_air_start", "major", 0.0, round(end, 2)))
        elif end >= duration - 0.05 and length >= EDGE_SILENCE_SEC:
            faults.append(Fault("dead_air_end", "major", round(start, 2), round(duration, 2)))
        elif length >= LONG_PAUSE_SEC:
            faults.append(Fault("long_pause", "minor", round(start, 2), round(end, 2)))
    for start, end in blacks:
        if end - start >= BLACK_SEC:
            faults.append(Fault("black_frames", "major", round(start, 2), round(end, 2)))
    first_db, last_db = edge_db
    if first_db is not None and first_db > EDGE_SPEECH_DB and not any(f.code == "dead_air_start" for f in faults):
        faults.append(Fault("clipped_word_start", "minor", 0.0, EDGE_PROBE_SEC))
    if last_db is not None and last_db > EDGE_SPEECH_DB and not any(f.code == "dead_air_end" for f in faults):
        faults.append(Fault("clipped_word_end", "minor", round(duration - EDGE_PROBE_SEC, 2), round(duration, 2)))
    return tuple(faults)


def measure_clip(path: Path) -> Measurement:
    duration = _duration(path)
    audio = _has_audio(path)
    silences = parse_silences(_ffmpeg_log(["-i", str(path), "-vn", "-af", f"silencedetect=noise={SILENCE_DB}dB:d=0.4"]), duration) if audio else []
    blacks = parse_blacks(_ffmpeg_log(["-i", str(path), "-an", "-vf", f"blackdetect=d={BLACK_SEC}:pix_th=0.10"]))
    edges = (_edge_volume(path, 0.0), _edge_volume(path, duration - EDGE_PROBE_SEC)) if audio else (None, None)
    return Measurement(duration, faults_from(duration, silences, blacks, audio, edges))


def trimmed_window(start: float, end: float, measurement: Measurement) -> tuple[float, float] | None:
    """A source window that drops edge dead air and widens cuts that clip a word, or None."""
    new_start, new_end = start, end
    for fault in measurement.faults:
        if fault.code == "dead_air_start":
            new_start = start + max(fault.endSec - TRIM_PAD_SEC, 0.0)
        elif fault.code == "dead_air_end":
            new_end = start + min(fault.startSec + TRIM_PAD_SEC, measurement.durationSec)
        elif fault.code == "clipped_word_start":
            new_start = max(start - WORD_PAD_SEC, 0.0)
        elif fault.code == "clipped_word_end":
            # ffmpeg stops at the end of the source if this runs past it.
            new_end = end + WORD_PAD_SEC
    if (new_start, new_end) == (start, end) or new_end - new_start < MIN_CLIP_SEC:
        return None
    return round(new_start, 3), round(new_end, 3)


CRITIC_RECUT_BELOW = 60
HOOK_SEARCH_SEC = 3.0
ENDING_EXTENSION_SEC = 2.0


def critic_window(start: float, end: float, critique: dict[str, Any]) -> tuple[float, float] | None:
    """A new window answering the blind critic's major hook and ending issues, or None.

    A weak opening inside the first seconds moves the start past it; an
    incomplete ending extends the cut so the thought can finish. Only a score
    under CRITIC_RECUT_BELOW acts, and the result is re-rendered and re-scored
    before anything replaces the first cut.
    """
    if critique.get("score", 100) >= CRITIC_RECUT_BELOW:
        return None
    new_start, new_end = start, end
    for issue in critique.get("issues") or []:
        if issue.get("severity") != "major":
            continue
        t = float(issue.get("tSec") or 0.0)
        if issue.get("criterion") == "hook" and t <= HOOK_SEARCH_SEC:
            new_start = max(new_start, start + max(t, 1.0))
        elif issue.get("criterion") == "ending":
            new_end = end + ENDING_EXTENSION_SEC
    if (new_start, new_end) == (start, end) or new_end - new_start < MIN_CLIP_SEC:
        return None
    return round(new_start, 3), round(new_end, 3)


def render_reviewed(
    render: Callable[[Path, float, float], list[str]],
    out_dir: Path,
    name: str,
    start: float,
    end: float,
    *,
    measure: Callable[[Path], Measurement] = measure_clip,
) -> tuple[Path, list[str], dict[str, Any]]:
    """Render, measure, apply the fix, re-render, and return the best version.

    ``render(out, start, end)`` renders one version and returns its notes.
    """
    versions: list[tuple[Path, list[str], Measurement, tuple[float, float]]] = []
    window = (start, end)
    for attempt in range(MAX_PASSES):
        out = out_dir / f"{name}-v{attempt + 1}.mp4"
        notes = render(out, *window)
        measurement = measure(out)
        versions.append((out, notes, measurement, window))
        next_window = trimmed_window(*window, measurement)
        if next_window is None or next_window in [version[3] for version in versions]:
            break
        window = next_window
    kept = max(range(len(versions)), key=lambda index: (versions[index][2].rank(), -index))
    path, notes, measurement, kept_window = versions[kept]
    review = {
        "gate": "measured", "kept": kept + 1, "passed": measurement.passed,
        "versions": [{"window": [round(w[0], 3), round(w[1], 3)], **m.to_wire()} for _, _, m, w in versions],
    }
    if kept > 0:
        notes = [*notes, f"trimmed dead air: kept version {kept + 1} ({kept_window[0]:.2f}–{kept_window[1]:.2f} s)"]
    return path, notes, review
