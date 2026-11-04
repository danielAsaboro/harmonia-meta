"""Narrated video and voiceover generation on Meta models.

Meta Model API has no speech synthesis or video generation endpoint, so Harmonia
composes both from Meta parts:

* Muse Spark plans the video scene by scene with the ``narrated-video-production``
  skill (narration, on-screen caption, and a visual prompt per scene).
* Muse Image draws one vertical frame per scene.
* Meta's open-weight MMS-TTS model (``facebook/mms-tts-eng``, Massively
  Multilingual Speech) speaks each narration line, self-hosted on CPU.
* ffmpeg (deterministic) adds a slow push-in, burns the caption, and cuts the
  scenes into one 1080x1920 H.264/AAC MP4.
* Muse Voice Transcribe listens to the finished file and Harmonia checks that the
  spoken words match the approved narration before the asset counts as rendered.
"""

from __future__ import annotations

import argparse
import io
import json
import logging
import os
import re
import subprocess
import sys
import tempfile
import threading
import wave
from collections.abc import Callable
from datetime import datetime, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from . import content, meta_api
from .model_catalog import PRICING_VERSION, estimate_text_cost
from .provider_schema import meta_output_schema
from .telemetry import current_trace_id, safe_attributes, tracer
from .usage import InvocationContext, UsageRecord
from .web_client import report_usage, reserve_budget, resolve_budget_reservation

logger = logging.getLogger("harmonia.media_studio")

SKILL_DIR = Path(__file__).parent / "skills" / "narrated-video-production"
DEFAULT_TTS_MODEL = "facebook/mms-tts-eng"
DEFAULT_PLANNER_MODEL = "muse-spark-1.3"
WIDTH, HEIGHT, FPS = 1080, 1920, 30
IMAGE_SIZE = "1024x1536"  # Muse Image treats size as an aspect ratio
MAX_SCENE_WORDS = 60
MAX_VIDEO_SECONDS = 90
SCENE_PAUSE_SECONDS = 0.35
PLAN_MAX_COST_USD = Decimal("0.050000")
NARRATION_MATCH_THRESHOLD = 0.6
FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    "/Library/Fonts/Arial Bold.ttf",
)


class MediaStudioError(RuntimeError):
    pass


class VideoScene(BaseModel):
    model_config = ConfigDict(extra="forbid")

    narration: str = Field(min_length=1, max_length=400)
    caption: str = Field(min_length=1, max_length=80)
    visualPrompt: str = Field(min_length=1, max_length=600)

    @field_validator("narration")
    @classmethod
    def speakable(cls, value: str) -> str:
        value = " ".join(value.split())
        if len(value.split()) > MAX_SCENE_WORDS:
            raise ValueError(f"narration exceeds {MAX_SCENE_WORDS} words")
        return value


class NarratedVideoPlan(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str = Field(min_length=1, max_length=120)
    centralArgument: str = Field(min_length=1, max_length=300)
    scenes: list[VideoScene] = Field(min_length=1, max_length=6)

    def narration(self) -> str:
        return " ".join(scene.narration for scene in self.scenes)

    def digest(self) -> str:
        return sha256(self.model_dump_json().encode()).hexdigest()


def tts_model() -> str:
    return os.environ.get("TTS_MODEL_ID") or DEFAULT_TTS_MODEL


def planner_model() -> str:
    return os.environ.get("VIDEO_PLANNER_MODEL_ID") or os.environ.get("MODEL_ID") or DEFAULT_PLANNER_MODEL


def skill_instructions() -> str:
    """The skill body plus its pacing reference, as planner instructions."""
    body = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8").split("---", 2)[-1].strip()
    pacing = (SKILL_DIR / "references" / "voice-and-pacing.md").read_text(encoding="utf-8").strip()
    return f"{body}\n\n{pacing}\n\nReturn only the JSON object for the plan."


# --------------------------------------------------------------------------- TTS


class MmsVoice:
    """Lazy, process-wide Meta MMS-TTS (VITS) voice. CPU is enough: ~5x realtime."""

    _lock = threading.Lock()
    _loaded: dict[str, tuple[Any, Any]] = {}

    def __init__(self, model_id: str | None = None):
        self.model_id = model_id or tts_model()

    def _model(self) -> tuple[Any, Any]:
        with self._lock:
            if self.model_id not in self._loaded:
                try:
                    from transformers import AutoTokenizer, VitsModel
                except ImportError as exc:  # pragma: no cover - depends on the image
                    raise MediaStudioError("MMS-TTS needs torch and transformers installed") from exc
                model = VitsModel.from_pretrained(self.model_id)
                model.eval()
                self._loaded[self.model_id] = (model, AutoTokenizer.from_pretrained(self.model_id))
            return self._loaded[self.model_id]

    def synthesize(self, text: str) -> bytes:
        """Speak ``text`` and return mono 16-bit PCM WAV bytes."""
        import torch

        model, tokenizer = self._model()
        inputs = tokenizer(text, return_tensors="pt")
        if inputs["input_ids"].shape[-1] == 0:
            raise MediaStudioError("narration has no speakable characters")
        torch.manual_seed(int(sha256(text.encode()).hexdigest()[:8], 16))  # same line, same take
        with torch.no_grad():
            waveform = model(**inputs).waveform[0]
        peak = float(waveform.abs().max()) or 1.0
        pcm = (waveform / peak * 0.9 * 32767).to(torch.int16).numpy().tobytes()
        out = io.BytesIO()
        with wave.open(out, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(int(model.config.sampling_rate))
            writer.writeframes(pcm)
        return out.getvalue()


def wav_seconds(wav_bytes: bytes) -> float:
    with wave.open(io.BytesIO(wav_bytes), "rb") as reader:
        return reader.getnframes() / float(reader.getframerate())


def _report_tts(invocation: InvocationContext | None, role: str, seconds: float,
                usage_reporter: Callable[[dict[str, object]], None]) -> None:
    if invocation is None:
        return
    operation_id = invocation.role_operation_id(role)
    usage_reporter(UsageRecord(
        id=f"usage-{sha256(operation_id.encode()).hexdigest()[:24]}",
        job_id=invocation.job_id, operation_id=operation_id, stage=invocation.stage, role=role,
        model=tts_model(), input_units=0, output_units=max(1, round(seconds)), unit_type="audio_seconds",
        # Open weights, self-hosted on the agent's own CPU: no per-call provider charge.
        estimated_cost_usd="0.000000", trace_id=current_trace_id(),
        created_at=datetime.now(timezone.utc).isoformat(),
    ).to_wire())


def synthesize_voiceover(
    plan: NarratedVideoPlan, *, voice: MmsVoice | None = None,
    invocation: InvocationContext | None = None,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> list[bytes]:
    """One WAV per scene, in order."""
    voice = voice or MmsVoice()
    with tracer().start_as_current_span("harmonia.model.speak") as span:
        clips = [voice.synthesize(scene.narration) for scene in plan.scenes]
        seconds = sum(wav_seconds(clip) for clip in clips)
        span.set_attributes(safe_attributes({"model": voice.model_id, "output.units": round(seconds),
                                             "scenes": len(clips)}))
        if seconds > MAX_VIDEO_SECONDS:
            raise MediaStudioError(f"narration runs {seconds:.0f}s, over the {MAX_VIDEO_SECONDS}s limit")
        _report_tts(invocation, "voice_narrator", seconds, usage_reporter)
    return clips


# ------------------------------------------------------------------ ffmpeg render


def _ffmpeg(args: list[str], timeout: int = 300) -> None:
    proc = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", *args],
                          capture_output=True, text=True, timeout=timeout)
    if proc.returncode != 0:
        raise MediaStudioError(f"ffmpeg failed: {(proc.stderr or '')[-400:]}")


def _font() -> str | None:
    return next((path for path in FONT_CANDIDATES if Path(path).exists()), None)


def _wrap(text: str, width: int = 22) -> str:
    lines, line = [], ""
    for word in text.split():
        if line and len(line) + 1 + len(word) > width:
            lines.append(line)
            line = word
        else:
            line = f"{line} {word}".strip()
    return "\n".join([*lines, line][:3])


def _scene_filter(seconds: float, caption_file: Path | None) -> str:
    frames = max(1, int(seconds * FPS))
    chain = (
        f"scale={WIDTH * 2}:{HEIGHT * 2}:force_original_aspect_ratio=increase,"
        f"crop={WIDTH * 2}:{HEIGHT * 2},"
        f"zoompan=z='min(1+0.10*on/{frames},1.10)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
        f":d={frames}:s={WIDTH}x{HEIGHT}:fps={FPS},format=yuv420p"
    )
    font = _font()
    if caption_file is not None and font:
        chain += (
            f",drawtext=fontfile='{font}':textfile='{caption_file}':fontsize=76:fontcolor=white"
            ":line_spacing=14:box=1:boxcolor=black@0.55:boxborderw=28:x=(w-text_w)/2:y=h*0.72"
        )
    return chain


def render_scene(image: bytes, narration_wav: bytes, caption: str, workdir: Path, index: int) -> Path:
    image_path, audio_path = workdir / f"scene{index}.img", workdir / f"scene{index}.wav"
    caption_path, out = workdir / f"scene{index}.txt", workdir / f"scene{index}.mp4"
    image_path.write_bytes(image)
    audio_path.write_bytes(narration_wav)
    caption_path.write_text(_wrap(caption), encoding="utf-8")
    seconds = wav_seconds(narration_wav) + SCENE_PAUSE_SECONDS
    _ffmpeg([
        "-loop", "1", "-i", str(image_path), "-i", str(audio_path),
        "-filter_complex", f"[0:v]{_scene_filter(seconds, caption_path)}[v];[1:a]apad,aresample=48000[a]",
        "-map", "[v]", "-map", "[a]", "-t", f"{seconds:.3f}",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21", "-r", str(FPS),
        "-c:a", "aac", "-b:a", "160k", "-ac", "2", str(out),
    ])
    return out


def concat_scenes(scenes: list[Path], out: Path) -> Path:
    listing = out.with_suffix(".txt")
    listing.write_text("".join(f"file '{path}'\n" for path in scenes), encoding="utf-8")
    _ffmpeg(["-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy",
             "-movflags", "+faststart", str(out)])
    return out


def concat_voiceover(clips: list[bytes], workdir: Path) -> bytes:
    """Scene narrations back to back with short pauses, as an M4A (AAC) file."""
    inputs: list[str] = []
    for index, clip in enumerate(clips):
        path = workdir / f"vo{index}.wav"
        path.write_bytes(clip)
        inputs += ["-i", str(path)]
    pads = "".join(f"[{i}:a]apad=pad_dur={SCENE_PAUSE_SECONDS},aresample=48000[a{i}];" for i in range(len(clips)))
    joined = "".join(f"[a{i}]" for i in range(len(clips)))
    out = workdir / "voiceover.m4a"
    _ffmpeg([*inputs, "-filter_complex", f"{pads}{joined}concat=n={len(clips)}:v=0:a=1[out]",
             "-map", "[out]", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", str(out)])
    return out.read_bytes()


def probe_duration(path: Path) -> float:
    proc = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                          capture_output=True, text=True, timeout=60)
    return float(proc.stdout.strip() or 0)


# ------------------------------------------------------------- Muse Spark plan


def plan_narrated_video(
    context: dict[str, Any], *, invocation: InvocationContext | None = None,
    post: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    budget_reserver: Callable[[dict[str, object]], None] = reserve_budget,
    budget_resolver: Callable[[dict[str, object]], None] = resolve_budget_reservation,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> NarratedVideoPlan:
    """Muse Spark writes the scene plan with the narrated-video-production skill."""
    model = planner_model()
    role = "video_director"
    payload = {
        "model": model, "instructions": skill_instructions(),
        "input": json.dumps(context, ensure_ascii=False)[:24_000],
        "text": {"format": {"type": "json_schema", "name": "NarratedVideoPlan",
                            "schema": meta_output_schema(NarratedVideoPlan), "strict": True}},
        "reasoning": {"effort": "low"}, "max_output_tokens": 8_000, "store": False,
    }
    operation_id = invocation.role_operation_id(role) if invocation else None
    if invocation is not None:
        budget_reserver({"jobId": invocation.job_id, "operationId": operation_id, "stage": invocation.stage,
                         "role": role, "model": model, "estimatedCostUsd": str(PLAN_MAX_COST_USD),
                         "pricingVersion": PRICING_VERSION})
    dispatched = False
    try:
        with tracer().start_as_current_span("harmonia.model.generate") as span:
            span.set_attributes(safe_attributes({"agent": role, "model": model}))
            dispatched = True
            if post is not None:
                body = post(payload)
            else:
                with meta_api.client(180.0, purpose="narrated video planning") as client:
                    response = client.post("/responses", json=payload)
                    response.raise_for_status()
                    body = response.json()
            if body.get("status") not in (None, "completed"):
                raise MediaStudioError(f"video plan did not complete ({body.get('status')})")
            text = "".join(
                part.get("text", "") for item in body.get("output") or [] if item.get("type") == "message"
                for part in item.get("content") or [] if part.get("type") == "output_text"
            )
            candidates = [text, text[text.find("{"):text.rfind("}") + 1]] if "{" in text else [text]
            plan = None
            for candidate in candidates:
                try:
                    plan = NarratedVideoPlan.model_validate_json(candidate)
                    break
                except ValidationError:
                    continue
            if plan is None:
                raise MediaStudioError("video plan was not a valid NarratedVideoPlan")
            usage = body.get("usage") or {}
            if invocation is not None:
                tokens_in, tokens_out = int(usage.get("input_tokens") or 0), int(usage.get("output_tokens") or 0)
                usage_reporter(UsageRecord(
                    id=f"usage-{sha256(operation_id.encode()).hexdigest()[:24]}", job_id=invocation.job_id,
                    operation_id=operation_id, stage=invocation.stage, role=role, model=model,
                    input_units=tokens_in, output_units=tokens_out, unit_type="tokens",
                    estimated_cost_usd=str(estimate_text_cost(model, tokens_in, tokens_out)),
                    trace_id=current_trace_id(), created_at=datetime.now(timezone.utc).isoformat(),
                ).to_wire())
            return plan
    except Exception as exc:
        if invocation is not None:
            content._resolve_without_masking(budget_resolver, {
                "jobId": invocation.job_id, "operationId": operation_id,
                "outcome": "uncertain" if dispatched else "not_invoked",
                "reason": "provider request outcome is unknown after dispatch" if dispatched
                else "provider request was not dispatched",
            })
        if isinstance(exc, MediaStudioError):
            raise
        raise MediaStudioError(f"video planning failed: {exc}") from exc


def plan_context_from_job(job: dict[str, Any]) -> dict[str, Any]:
    """The grounded, already-approved material a video may draw on."""
    analysis = job.get("sourceAnalysis") or {}
    goals = job.get("goals") or {}
    brief = goals.get("brandBrief") or {}
    drafts = [
        {"platform": draft.get("platform"), "text": draft.get("text")}
        for draft in (job.get("drafts") or []) if isinstance(draft, dict) and draft.get("text")
    ][:6]
    return {
        "brief": {
            "operatorBrief": job.get("brief") or job.get("title") or "",
            "company": brief.get("company") or goals.get("company"),
            "audience": brief.get("audiences") or goals.get("audience"),
            "voiceRules": brief.get("voiceRules"),
            "exclusions": brief.get("exclusions"),
        },
        "angles": [
            {"title": a.get("title"), "rationale": a.get("rationale"), "kind": a.get("kind")}
            for a in (analysis.get("angles") or [])[:5]
        ],
        "moments": [{"title": m.get("title"), "quote": m.get("quote")} for m in (analysis.get("moments") or [])[:5]],
        "drafts": drafts,
    }


# ------------------------------------------------------------------ narration QA


def _words(text: str) -> list[str]:
    return re.findall(r"[a-z0-9']+", text.lower())


def narration_match(expected: str, heard: str) -> float:
    """Share of the planned narration's words that the transcriber heard."""
    want = _words(expected)
    if not want:
        return 0.0
    pool: dict[str, int] = {}
    for word in _words(heard):
        pool[word] = pool.get(word, 0) + 1
    hits = 0
    for word in want:
        if pool.get(word, 0) > 0:
            pool[word] -= 1
            hits += 1
    return round(hits / len(want), 3)


def verify_narration(media: bytes, mime: str, plan: NarratedVideoPlan, *,
                     invocation: InvocationContext | None = None,
                     transcriber: Callable[..., dict] | None = None) -> dict[str, Any]:
    """Muse Voice Transcribe listens back; the asset passes only if the words match."""
    transcriber = transcriber or content.transcribe_audio
    result = transcriber(media, mime, invocation=invocation)
    heard = " ".join(seg.get("text", "") for seg in result.get("segments") or [])
    score = narration_match(plan.narration(), heard)
    return {"model": content.model_used(), "score": score, "passed": score >= NARRATION_MATCH_THRESHOLD,
            "heard": heard[:2000]}


# ---------------------------------------------------------------- orchestration


ImageFn = Callable[[str, int], tuple[bytes, str]]


def muse_image_frames(invocation: InvocationContext) -> ImageFn:
    def draw(prompt: str, index: int) -> tuple[bytes, str]:
        scene = invocation.model_copy(update={"operation_id": f"{invocation.operation_id}:scene-{index}"})
        return content.generate_image(
            f"{prompt}\nVertical 2:3 composition. No text, letters, logos, or watermarks.",
            invocation=scene, size=IMAGE_SIZE,
        )
    return draw


def placeholder_frames(prompt: str, index: int) -> tuple[bytes, str]:
    """Offline frames for tests and dry runs: a gradient, no model call."""
    with tempfile.TemporaryDirectory() as td:
        out = Path(td) / "frame.png"
        hue = (index * 67) % 360
        _ffmpeg(["-f", "lavfi", "-i", f"gradients=s=1024x1536:c0=0x1d2b53:c1=0x7e2553:seed={index}",
                 "-vf", f"hue=h={hue}", "-frames:v", "1", str(out)], timeout=60)
        return out.read_bytes(), "image/png"


def render_narrated_video(
    plan: NarratedVideoPlan, *, images: ImageFn, voice: MmsVoice | None = None,
    invocation: InvocationContext | None = None,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> tuple[bytes, dict[str, Any]]:
    """Render the plan to MP4 bytes plus a render report."""
    clips = synthesize_voiceover(plan, voice=voice, invocation=invocation, usage_reporter=usage_reporter)
    with tempfile.TemporaryDirectory() as td, tracer().start_as_current_span("harmonia.media.render_video") as span:
        workdir = Path(td)
        scene_paths = []
        for index, (scene, clip) in enumerate(zip(plan.scenes, clips)):
            frame, _mime = images(scene.visualPrompt, index)
            scene_paths.append(render_scene(frame, clip, scene.caption, workdir, index))
        out = concat_scenes(scene_paths, workdir / "narrated.mp4")
        duration = probe_duration(out)
        data = out.read_bytes()
        span.set_attributes(safe_attributes({"scenes": len(scene_paths), "duration.seconds": round(duration, 2)}))
    return data, {
        "planDigest": plan.digest(), "scenes": len(plan.scenes), "durationSec": round(duration, 2),
        "width": WIDTH, "height": HEIGHT, "voiceModel": (voice or MmsVoice()).model_id,
        "imageModel": content.image_model(), "bytes": len(data),
    }


def render_voiceover(
    plan: NarratedVideoPlan, *, voice: MmsVoice | None = None, invocation: InvocationContext | None = None,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> tuple[bytes, dict[str, Any]]:
    clips = synthesize_voiceover(plan, voice=voice, invocation=invocation, usage_reporter=usage_reporter)
    with tempfile.TemporaryDirectory() as td:
        data = concat_voiceover(clips, Path(td))
        probe = Path(td) / "probe.m4a"
        probe.write_bytes(data)
        duration = probe_duration(probe)
    return data, {"planDigest": plan.digest(), "scenes": len(plan.scenes), "durationSec": round(duration, 2),
                  "voiceModel": (voice or MmsVoice()).model_id, "bytes": len(data)}


# -------------------------------------------------------------------------- CLI


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Render a narrated video or voiceover with Meta models.")
    parser.add_argument("--plan", type=Path, help="NarratedVideoPlan JSON; skips Muse Spark planning")
    parser.add_argument("--context", type=Path, help="planning context JSON (brief, angles, drafts)")
    parser.add_argument("--out", type=Path, required=True, help=".mp4 for video, .m4a for voiceover only")
    parser.add_argument("--placeholder-images", action="store_true", help="gradient frames, no Muse Image calls")
    parser.add_argument("--verify", action="store_true", help="listen back with Muse Voice Transcribe")
    args = parser.parse_args(argv)
    # Outside a job nothing is billed or uploaded, so the web callback settings are inert.
    os.environ.setdefault("WEB_INTERNAL_URL", "http://localhost:3000")
    os.environ.setdefault("INTERNAL_API_TOKEN", "cli-unused")
    if args.plan:
        plan = NarratedVideoPlan.model_validate_json(args.plan.read_text(encoding="utf-8"))
    elif args.context:
        plan = plan_narrated_video(json.loads(args.context.read_text(encoding="utf-8")))
    else:
        parser.error("pass --plan or --context")
    noop = lambda _record: None  # noqa: E731 - CLI runs outside a job, nothing to bill against
    invocation = InvocationContext(job_id="cli", workspace_id="cli", brand_id="cli", user_id="cli",
                                   stage="publish", operation_id="cli:media-studio")
    if args.out.suffix == ".m4a":
        data, report = render_voiceover(plan, usage_reporter=noop)
        mime = "audio/mp4"
    else:
        if args.placeholder_images:
            images: ImageFn = placeholder_frames
        else:
            def images(prompt: str, index: int) -> tuple[bytes, str]:
                return content.generate_image(
                    f"{prompt}\nVertical 2:3 composition. No text, letters, logos, or watermarks.",
                    invocation=invocation.model_copy(update={"operation_id": f"cli:scene-{index}"}),
                    size=IMAGE_SIZE, budget_reserver=noop, budget_resolver=noop, usage_reporter=noop,
                )
        data, report = render_narrated_video(plan, images=images, usage_reporter=noop)
        mime = "video/mp4"
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_bytes(data)
    if args.verify:
        report["narrationCheck"] = verify_narration(data, mime, plan, transcriber=lambda media, m, invocation=None:
                                                    content.transcribe_audio(media, m, invocation=invocation_for_cli(),
                                                                             budget_reserver=noop, budget_resolver=noop,
                                                                             usage_reporter=noop))
    report["plan"] = plan.model_dump()
    args.out.with_suffix(".json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    sys.stdout.write(json.dumps({k: v for k, v in report.items() if k != "plan"}, indent=2) + "\n")
    return 0


def invocation_for_cli() -> InvocationContext:
    return InvocationContext(job_id="cli", workspace_id="cli", brand_id="cli", user_id="cli",
                             stage="publish", operation_id="cli:media-studio:verify")


if __name__ == "__main__":
    raise SystemExit(main())
