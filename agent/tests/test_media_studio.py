import io
import json
import math
import shutil
import struct
import wave

import pytest

from harmonia_agent import media_studio
from harmonia_agent.media_studio import MediaStudioError, NarratedVideoPlan

needs_ffmpeg = pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")


def _plan(scenes: int = 2) -> NarratedVideoPlan:
    return NarratedVideoPlan.model_validate({
        "title": "Record once",
        "centralArgument": "One recording becomes a week of grounded posts.",
        "scenes": [
            {"narration": f"Scene {i} says one clear thing about your recording.", "caption": f"Caption {i}",
             "visualPrompt": "A desk lamp over a stack of cassettes, moody light"}
            for i in range(scenes)
        ],
    })


class ToneVoice:
    """Stands in for MMS-TTS: 0.1 s of tone per word, mono 16 kHz WAV."""

    model_id = "facebook/mms-tts-eng"

    def __init__(self):
        self.lines: list[str] = []

    def synthesize(self, text: str) -> bytes:
        self.lines.append(text)
        rate, seconds = 16_000, 0.1 * len(text.split())
        frames = b"".join(struct.pack("<h", int(8000 * math.sin(2 * math.pi * 220 * n / rate)))
                          for n in range(int(rate * seconds)))
        out = io.BytesIO()
        with wave.open(out, "wb") as writer:
            writer.setnchannels(1)
            writer.setsampwidth(2)
            writer.setframerate(rate)
            writer.writeframes(frames)
        return out.getvalue()


def test_plan_rejects_unspeakably_long_scenes():
    with pytest.raises(ValueError):
        NarratedVideoPlan.model_validate({
            "title": "t", "centralArgument": "c",
            "scenes": [{"narration": "word " * 61, "caption": "c", "visualPrompt": "v"}],
        })


def test_skill_instructions_load_skill_body_and_pacing_reference():
    text = media_studio.skill_instructions()
    assert "Narrated Video Production" in text
    assert "Voice and pacing" in text
    assert not text.startswith("---")


def test_narration_match_counts_heard_words_once():
    assert media_studio.narration_match("record once and ship", "Record once, and ship!") == 1.0
    assert media_studio.narration_match("ship ship ship ship", "ship") == 0.25
    assert media_studio.narration_match("", "anything") == 0.0


def test_verify_narration_fails_when_transcript_drifts():
    plan = _plan(1)
    heard = {"segments": [{"text": "completely different words"}]}
    check = media_studio.verify_narration(b"x", "video/mp4", plan, transcriber=lambda *a, **k: heard)
    assert check["passed"] is False
    good = {"segments": [{"text": plan.narration()}]}
    assert media_studio.verify_narration(b"x", "video/mp4", plan, transcriber=lambda *a, **k: good)["passed"]


def test_plan_narrated_video_parses_strict_output_and_reports_usage():
    plan = _plan(3)
    body = {"status": "completed", "usage": {"input_tokens": 900, "output_tokens": 300},
            "output": [{"type": "message", "content": [{"type": "output_text", "text": plan.model_dump_json()}]}]}
    seen, reserved, usage = {}, [], []

    def post(payload):
        seen.update(payload)
        return body

    from harmonia_agent.usage import InvocationContext
    invocation = InvocationContext(job_id="job", workspace_id="w", brand_id="b", user_id="u",
                                   stage="publish", operation_id="job:publish:narrated-video")
    result = media_studio.plan_narrated_video({"angles": [{"title": "a"}]}, invocation=invocation, post=post,
                                              budget_reserver=reserved.append, usage_reporter=usage.append)
    assert result == plan
    assert seen["text"]["format"]["name"] == "NarratedVideoPlan"
    assert "Narrated Video Production" in seen["instructions"]
    assert reserved[0]["role"] == "video_director"
    assert usage[0]["inputUnits"] == 900 and usage[0]["unitType"] == "tokens"


def test_plan_narrated_video_resolves_budget_on_bad_output():
    resolved = []
    body = {"status": "completed", "output": [{"type": "message", "content": [{"type": "output_text", "text": "nope"}]}]}
    from harmonia_agent.usage import InvocationContext
    invocation = InvocationContext(job_id="job", workspace_id="w", brand_id="b", user_id="u",
                                   stage="publish", operation_id="op")
    with pytest.raises(MediaStudioError):
        media_studio.plan_narrated_video({}, invocation=invocation, post=lambda _p: body,
                                         budget_reserver=lambda _p: None, budget_resolver=resolved.append,
                                         usage_reporter=lambda _p: None)
    assert resolved[0]["outcome"] == "uncertain"


def test_plan_context_from_job_keeps_only_grounded_material():
    job = {"brief": "Launch week", "sourceAnalysis": {"angles": [{"id": "a1", "title": "T", "rationale": "R"}],
                                                     "moments": [{"title": "M", "quote": "Q"}]},
           "drafts": [{"platform": "x", "text": "Post"}, {"platform": "x"}],
           "goals": {"brandBrief": {"company": "Acme", "voiceRules": ["plain words"]}}}
    context = media_studio.plan_context_from_job(job)
    assert context["brief"]["company"] == "Acme"
    assert context["angles"] == [{"title": "T", "rationale": "R", "kind": None}]
    assert context["drafts"] == [{"platform": "x", "text": "Post"}]


@needs_ffmpeg
def test_render_voiceover_speaks_every_scene_in_order():
    voice, usage = ToneVoice(), []
    from harmonia_agent.usage import InvocationContext
    invocation = InvocationContext(job_id="job", workspace_id="w", brand_id="b", user_id="u",
                                   stage="publish", operation_id="op")
    data, report = media_studio.render_voiceover(_plan(2), voice=voice, invocation=invocation,
                                                 usage_reporter=usage.append)
    assert voice.lines == [scene.narration for scene in _plan(2).scenes]
    assert data[4:8] == b"ftyp"
    assert report["durationSec"] > 1.5
    assert usage[0]["model"] == "facebook/mms-tts-eng" and usage[0]["unitType"] == "audio_seconds"
    assert usage[0]["estimatedCostUsd"] == "0.000000"


@needs_ffmpeg
def test_render_narrated_video_cuts_vertical_mp4_one_frame_per_scene():
    prompts = []

    def frames(prompt, index):
        prompts.append((index, prompt))
        return media_studio.placeholder_frames(prompt, index)

    data, report = media_studio.render_narrated_video(_plan(2), images=frames, voice=ToneVoice(),
                                                      usage_reporter=lambda _r: None)
    assert [index for index, _ in prompts] == [0, 1]
    assert data[4:8] == b"ftyp"
    assert (report["width"], report["height"], report["scenes"]) == (1080, 1920, 2)
    assert report["durationSec"] == pytest.approx(2 * (0.1 * 9 + media_studio.SCENE_PAUSE_SECONDS), abs=0.4)


def test_overlong_narration_is_refused_before_rendering():
    class SlowVoice(ToneVoice):
        def synthesize(self, text):
            out = io.BytesIO()
            with wave.open(out, "wb") as writer:
                writer.setnchannels(1)
                writer.setsampwidth(2)
                writer.setframerate(1000)
                writer.writeframes(b"\0\0" * 1000 * 50)
            return out.getvalue()

    with pytest.raises(MediaStudioError, match="over the"):
        media_studio.synthesize_voiceover(_plan(2), voice=SlowVoice(), usage_reporter=lambda _r: None)


def test_demo_plan_in_evidence_is_valid():
    from pathlib import Path
    path = Path(__file__).resolve().parents[2] / "evidence" / "media" / "harmonia-demo-plan.json"
    if not path.exists():
        pytest.skip("demo plan not present")
    plan = NarratedVideoPlan.model_validate(json.loads(path.read_text()))
    assert 3 <= len(plan.scenes) <= 5
