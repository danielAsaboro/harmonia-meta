"""YouTube ingestion: metadata via official endpoints, media via yt-dlp."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import tempfile
from pathlib import Path

import httpx


class IngestError(RuntimeError):
    pass


def extract_video_id(url: str) -> str:
    m = re.search(r"(?:v=|youtu\.be/|/shorts/)([\w-]{11})", url)
    if not m:
        raise IngestError(f"cannot extract video id from {url}")
    return m.group(1)


def fetch_metadata(video_id: str) -> dict:
    """oEmbed works keyless; Data API adds duration when YOUTUBE_API_KEY is set."""
    with httpx.Client(timeout=20) as c:
        res = c.get(
            "https://www.youtube.com/oembed",
            params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"},
        )
        if res.status_code != 200:
            raise IngestError(f"oEmbed returned HTTP {res.status_code}")
        data = res.json()
    meta = {
        "videoId": video_id,
        "title": data["title"],
        "channel": data["author_name"],
        "thumbnailUrl": data["thumbnail_url"],
    }
    key = __import__("os").environ.get("YOUTUBE_API_KEY")
    if key:
        api = httpx.get(
            "https://www.googleapis.com/youtube/v3/videos",
            params={"part": "contentDetails", "id": video_id, "key": key},
            timeout=20,
        )
        if api.status_code == 200:
            items = api.json().get("items", [])
            if items:
                iso = items[0]["contentDetails"]["duration"]
                h, m, s = map(int, re.findall(r"\d+", iso) or [0, 0, 0])
                parts = [h, m, s] if "H" in iso else [m, s]
                while len(parts) < 3:
                    parts.insert(0, 0)
                meta["durationSec"] = parts[0] * 3600 + parts[1] * 60 + parts[2]
    meta.setdefault("durationSec", 0)
    return meta


def download_audio(url: str, max_bytes: int = 24_000_000) -> tuple[bytes, str]:
    """Downloads bestaudio via yt-dlp and returns (audio_bytes, sha256)."""
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "a.m4a"
        failures = []
        # YouTube can reject one anonymous player client while another remains
        # valid. Keep this recovery host-owned, cookie-free, and strictly
        # bounded; never ask an LLM to select clients or invent success.
        for player_client in ("web_embedded", "android_vr", "mweb"):
            out.unlink(missing_ok=True)
            extractor_args = ["--extractor-args", f"youtube:player_client={player_client}"]
            if player_client == "mweb":
                # Use the provider's per-invocation script as the authoritative
                # fallback. This avoids a startup race with its HTTP server and
                # keeps token generation bound to this exact video request.
                extractor_args.extend([
                    "--extractor-args",
                    "youtubepot-bgutilscript:server_home=/opt/bgutil-ytdlp-pot-provider/server",
                ])
            proc = subprocess.run(
                ["yt-dlp", *extractor_args,
                 "-f", "bestaudio[ext=m4a][abr<=160]/bestaudio[abr<=160]/bestaudio",
                 "-x", "--audio-format", "m4a", "--audio-quality", "9",
                 "--no-playlist", "--no-part", "-o", str(out), url],
                capture_output=True, text=True, timeout=600,
            )
            if proc.returncode == 0 and out.exists():
                break
            failures.append(f"{player_client}: {(proc.stderr or '')[-240:]}")
        else:
            raise IngestError(f"yt-dlp failed after bounded client recovery: {' | '.join(failures)}")
        data = out.read_bytes()
        if len(data) > max_bytes:
            raise IngestError(f"audio too large for inline transcription ({len(data)} bytes)")
        return data, hashlib.sha256(data).hexdigest()


def probe_audio_duration(audio: bytes) -> int:
    """Measures real audio duration locally with ffprobe (whole seconds).

    Used when the Data API is unavailable (no YOUTUBE_API_KEY), so ingestion
    never reports durationSec=0 for valid media.
    """
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "a.m4a"
        out.write_bytes(audio)
        proc = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", str(out)],
            capture_output=True, text=True, timeout=60,
        )
    if proc.returncode != 0:
        raise IngestError(f"ffprobe failed: {(proc.stderr or '')[-200:]}")
    try:
        seconds = int(float(proc.stdout.strip()))
    except ValueError as exc:
        raise IngestError("ffprobe produced no parsable duration") from exc
    if seconds <= 0:
        raise IngestError("ffprobe reported non-positive duration")
    return seconds


def iso8601_to_seconds(iso: str) -> int:
    h, m, s = 0, 0, 0
    nums = [int(n) for n in re.findall(r"\d+", iso)]
    if "H" in iso and len(nums) == 3:
        h, m, s = nums
    else:
        m, s = nums[-2:] if len(nums) >= 2 else [0, nums[0] if nums else 0]
    return h * 3600 + m * 60 + s
