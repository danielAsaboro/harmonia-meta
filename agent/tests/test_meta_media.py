"""Muse Voice Transcribe and Muse Image calls over the Meta Model API (mocked transport)."""

from __future__ import annotations

import base64
import io
import json
import shutil
import subprocess
import wave

import httpx
import pytest
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from harmonia_agent import content, youtube
from harmonia_agent.telemetry import configure_telemetry
from harmonia_agent.usage import InvocationContext

TRANSCRIBE_INVOCATION = InvocationContext(
    workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
    job_id="job-1", stage="extract_sources", operation_id="job-1:extract_sources:0",
)
IMAGE_INVOCATION = InvocationContext(
    workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
    job_id="job-1", stage="publish", operation_id="job-1:publish:act-img",
)


def _wav(seconds: float, rate: int = content.TRANSCRIBE_SAMPLE_RATE) -> bytes:
    out = io.BytesIO()
    with wave.open(out, "wb") as writer:
        writer.setnchannels(1)
        writer.setsampwidth(2)
        writer.setframerate(rate)
        writer.writeframes(b"\x00\x00" * int(rate * seconds))
    return out.getvalue()


def _multipart_parts(request: httpx.Request) -> dict[str, bytes]:
    boundary = request.headers["content-type"].split("boundary=")[1].encode()
    parts = {}
    for chunk in request.content.split(b"--" + boundary):
        if b"name=\"" not in chunk:
            continue
        header, _, body = chunk.partition(b"\r\n\r\n")
        name = header.split(b"name=\"")[1].split(b"\"")[0].decode()
        parts[name] = body.rstrip(b"\r\n")
    return parts


@pytest.fixture
def meta_api(monkeypatch):
    """Route content._http_client through a recording MockTransport."""
    monkeypatch.setenv("MODEL_API_KEY", "LLM_1_test")
    monkeypatch.delenv("META_API_BASE_URL", raising=False)
    monkeypatch.delenv("TRANSCRIBER_MODEL_ID", raising=False)
    monkeypatch.delenv("IMAGE_MODEL_ID", raising=False)
    state: dict = {"requests": [], "responses": []}
    real_client = content._http_client

    def handler(request: httpx.Request) -> httpx.Response:
        state["requests"].append(request)
        reply = state["responses"].pop(0)
        if isinstance(reply, Exception):
            raise reply
        return reply

    def client(timeout: float) -> httpx.Client:
        built = real_client(timeout)
        return httpx.Client(
            base_url=built.base_url, headers=built.headers,
            transport=httpx.MockTransport(handler),
        )

    monkeypatch.setattr(content, "_http_client", client)
    return state


def test_http_client_sends_bearer_key_to_configured_base(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "LLM_1_test")
    monkeypatch.delenv("META_API_BASE_URL", raising=False)
    with content._http_client(5.0) as client:
        assert str(client.base_url) == "https://api.meta.ai/v1/"
        assert client.headers["authorization"] == "Bearer LLM_1_test"
    monkeypatch.setenv("META_API_BASE_URL", "https://proxy.example.test/v1/")
    with content._http_client(5.0) as client:
        assert str(client.base_url) == "https://proxy.example.test/v1/"


def test_http_client_requires_model_api_key(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="MODEL_API_KEY"):
        content._http_client(5.0)


def test_split_wav_keeps_clips_under_the_duration_cap_with_offsets():
    clips = content._split_wav(_wav(5, rate=16_000), max_seconds=2)
    assert [offset for offset, _ in clips] == [0, 2000, 4000]
    with wave.open(io.BytesIO(clips[-1][1])) as last:
        assert (last.getnchannels(), last.getsampwidth(), last.getframerate()) == (1, 2, 16_000)
        assert last.getnframes() == 16_000


@pytest.mark.skipif(shutil.which("ffmpeg") is None, reason="ffmpeg not installed")
def test_normalize_to_wav_produces_mono_16bit_24khz(tmp_path):
    source = tmp_path / "tone.m4a"
    subprocess.run(
        ["ffmpeg", "-nostdin", "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
         "-ac", "2", "-ar", "44100", str(source)],
        check=True,
    )
    with wave.open(io.BytesIO(content._normalize_to_wav(source.read_bytes()))) as reader:
        assert (reader.getnchannels(), reader.getsampwidth(), reader.getframerate()) == (1, 2, 24_000)


def test_transcription_maps_turns_and_reports_audio_seconds(monkeypatch, meta_api):
    order: list[str] = []
    reservations: list[dict] = []
    reports: list[dict] = []
    monkeypatch.setattr(youtube, "probe_audio_duration", lambda _audio: 9)
    monkeypatch.setattr(content, "_normalize_to_wav", lambda _media: _wav(1))
    monkeypatch.setenv("TRANSCRIBER_MODEL_ID", "muse-voice-transcribe-1.0")
    meta_api["responses"].append(httpx.Response(200, json={
        "sessionId": "s", "transcript": "How is the weather? It is raining.", "audioDurationMs": 8240,
        "turns": [
            {"turnId": 1, "startMs": 1520, "endMs": 4640, "transcript": "How is the weather?"},
            {"turnId": 2, "startMs": 5900, "endMs": 8240, "transcript": "It is raining."},
            {"turnId": 3, "startMs": 8240, "endMs": 8240, "transcript": "  "},
        ],
    }))
    exporter = InMemorySpanExporter()
    configure_telemetry(exporter=exporter, force=True)

    result = content.transcribe_audio(
        b"m4a", "audio/mp4", invocation=TRANSCRIBE_INVOCATION,
        budget_reserver=lambda item: (reservations.append(item), order.append("reserve")),
        usage_reporter=lambda item: (reports.append(item), order.append("usage")),
    )

    assert result == {"language": "und", "segments": [
        {"id": "c0-t1", "startSec": 1.52, "endSec": 4.64, "text": "How is the weather?"},
        {"id": "c0-t2", "startSec": 5.9, "endSec": 8.24, "text": "It is raining."},
    ]}
    assert order == ["reserve", "usage"]
    request = meta_api["requests"][0]
    assert request.method == "POST"
    assert str(request.url).startswith("https://api.meta.ai/v1/asr/transcribe?sessionId=")
    assert request.headers["authorization"] == "Bearer LLM_1_test"
    assert request.headers["accept"] == "application/json"
    parts = _multipart_parts(request)
    assert json.loads(parts["request"]) == {
        "model": "muse-voice-transcribe-1.0", "mode": "ENDPOINTING", "audioEncoding": "WAV",
    }
    assert parts["audio"].startswith(b"RIFF")
    assert reservations[0] | {"estimatedCostUsd": None} == {
        "jobId": "job-1", "operationId": "job-1:extract_sources:0:transcriber",
        "stage": "extract_sources", "role": "transcriber", "model": "muse-voice-transcribe-1.0",
        "estimatedCostUsd": None, "pricingVersion": content.PRICING_VERSION,
    }
    assert reports[0]["unitType"] == "audio_seconds"
    assert reports[0]["inputUnits"] == 8
    assert reports[0]["estimatedCostUsd"] == "0.000400"
    span = next(s for s in exporter.get_finished_spans() if s.name == "harmonia.model.generate")
    assert span.attributes["model"] == "muse-voice-transcribe-1.0"


def test_transcription_reservation_prices_probed_duration(monkeypatch, meta_api):
    reservations: list[dict] = []
    monkeypatch.setattr(youtube, "probe_audio_duration", lambda _audio: 600)
    monkeypatch.setattr(content, "_normalize_to_wav", lambda _media: _wav(1))
    meta_api["responses"].append(httpx.Response(200, json={
        "transcript": "hello", "audioDurationMs": 1000,
        "turns": [{"turnId": 1, "startMs": 0, "endMs": 1000, "transcript": "hello"}],
    }))

    content.transcribe_audio(
        b"x" * 10_000_000, "audio/mp4", invocation=TRANSCRIBE_INVOCATION,
        budget_reserver=reservations.append, usage_reporter=lambda _item: None,
    )

    assert reservations[0]["estimatedCostUsd"] == "0.030050"


def test_long_media_is_sent_as_capped_clips_with_offset_timestamps(monkeypatch, meta_api):
    reports: list[dict] = []
    real_split = content._split_wav
    monkeypatch.setattr(youtube, "probe_audio_duration", lambda _audio: 3)
    monkeypatch.setattr(content, "_normalize_to_wav", lambda _media: _wav(3, rate=16_000))
    monkeypatch.setattr(content, "_split_wav", lambda wav: real_split(wav, max_seconds=2))
    meta_api["responses"].extend([
        httpx.Response(200, json={"transcript": "first", "audioDurationMs": 2000,
                                  "turns": [{"turnId": 1, "startMs": 100, "endMs": 1900, "transcript": "first"}]}),
        httpx.Response(200, json={"transcript": "second", "audioDurationMs": 1000,
                                  "turns": [{"turnId": 1, "startMs": 200, "endMs": 900, "transcript": "second"}]}),
    ])

    result = content.transcribe_audio(
        b"m4a", "audio/mp4", invocation=TRANSCRIBE_INVOCATION,
        budget_reserver=lambda _item: None, usage_reporter=reports.append,
    )

    assert [(s["startSec"], s["endSec"], s["text"]) for s in result["segments"]] == [
        (0.1, 1.9, "first"), (2.2, 2.9, "second"),
    ]
    session_ids = [r.url.params["sessionId"] for r in meta_api["requests"]]
    assert len(set(session_ids)) == 2
    assert reports[0]["inputUnits"] == 3


def test_transcript_without_turns_spans_the_clip(monkeypatch, meta_api):
    monkeypatch.setattr(youtube, "probe_audio_duration", lambda _audio: 2)
    monkeypatch.setattr(content, "_normalize_to_wav", lambda _media: _wav(1))
    meta_api["responses"].append(httpx.Response(200, json={
        "transcript": "Just one line.", "audioDurationMs": 1500, "turns": [],
    }))

    result = content.transcribe_audio(
        b"m4a", "audio/mp4", invocation=TRANSCRIBE_INVOCATION,
        budget_reserver=lambda _item: None, usage_reporter=lambda _item: None,
    )

    assert result["segments"] == [{"id": "c0", "startSec": 0.0, "endSec": 1.5, "text": "Just one line."}]


def test_transcription_releases_when_key_is_missing_before_dispatch(monkeypatch):
    resolutions: list[dict] = []
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    monkeypatch.setattr(youtube, "probe_audio_duration", lambda _audio: 1)
    monkeypatch.setattr(content, "_normalize_to_wav", lambda _media: _wav(1))

    with pytest.raises(RuntimeError, match="MODEL_API_KEY"):
        content.transcribe_audio(
            b"audio", "audio/mp4", invocation=TRANSCRIBE_INVOCATION,
            budget_reserver=lambda _item: None, budget_resolver=resolutions.append,
        )

    assert resolutions[0]["outcome"] == "not_invoked"


def test_transcription_quarantines_timeout_after_dispatch(monkeypatch, meta_api):
    resolutions: list[dict] = []
    monkeypatch.setattr(youtube, "probe_audio_duration", lambda _audio: 1)
    monkeypatch.setattr(content, "_normalize_to_wav", lambda _media: _wav(1))
    meta_api["responses"].append(httpx.ReadTimeout("timeout"))

    with pytest.raises(httpx.ReadTimeout):
        content.transcribe_audio(
            b"audio", "audio/mp4", invocation=TRANSCRIBE_INVOCATION,
            budget_reserver=lambda _item: None, budget_resolver=resolutions.append,
        )

    assert resolutions[0]["outcome"] == "uncertain"


def test_transcription_quarantines_provider_error_after_dispatch(monkeypatch, meta_api):
    resolutions: list[dict] = []
    monkeypatch.setattr(youtube, "probe_audio_duration", lambda _audio: 1)
    monkeypatch.setattr(content, "_normalize_to_wav", lambda _media: _wav(1))
    meta_api["responses"].append(httpx.Response(413, json={"error": {"message": "too large"}}))

    with pytest.raises(httpx.HTTPStatusError):
        content.transcribe_audio(
            b"audio", "audio/mp4", invocation=TRANSCRIBE_INVOCATION,
            budget_reserver=lambda _item: None, budget_resolver=resolutions.append,
        )

    assert resolutions[0]["outcome"] == "uncertain"


def test_image_generation_posts_to_images_generations(meta_api):
    reservations: list[dict] = []
    reports: list[dict] = []
    meta_api["responses"].append(httpx.Response(200, json={
        "created": 1784584435, "data": [{"b64_json": base64.b64encode(b"png-bytes").decode()}],
        "output_format": "png", "background": "opaque",
        "usage": {"input_tokens": 9831, "output_tokens": 749, "total_tokens": 10580},
    }))
    exporter = InMemorySpanExporter()
    configure_telemetry(exporter=exporter, force=True)

    generated, mime = content.generate_image(
        "safe visual description", invocation=IMAGE_INVOCATION,
        budget_reserver=reservations.append, usage_reporter=reports.append,
    )

    assert generated == b"png-bytes" and mime == "image/png"
    request = meta_api["requests"][0]
    assert str(request.url) == "https://api.meta.ai/v1/images/generations"
    assert request.headers["authorization"] == "Bearer LLM_1_test"
    assert json.loads(request.content) == {
        "model": "muse-image-1.0", "prompt": "safe visual description", "n": 1,
        "response_format": "b64_json", "output_format": "png",
    }
    assert reservations[0]["model"] == "muse-image-1.0"
    assert reservations[0]["estimatedCostUsd"] == "0.500000"
    assert reports[0]["unitType"] == "images"
    assert reports[0]["inputUnits"] == 1
    span = next(s for s in exporter.get_finished_spans() if s.name == "harmonia.model.generate")
    assert span.attributes["model"] == "muse-image-1.0"


def test_image_generation_honours_image_model_env(monkeypatch, meta_api):
    monkeypatch.setenv("IMAGE_MODEL_ID", "muse-image-2.0")
    meta_api["responses"].append(httpx.Response(200, json={
        "data": [{"b64_json": base64.b64encode(b"webp").decode()}], "output_format": "webp",
    }))

    _bytes, mime = content.generate_image(
        "safe visual description", invocation=IMAGE_INVOCATION,
        budget_reserver=lambda _item: None, usage_reporter=lambda _item: None,
    )

    assert mime == "image/webp"
    assert json.loads(meta_api["requests"][0].content)["model"] == "muse-image-2.0"


def test_image_generation_releases_reservation_when_key_is_missing(monkeypatch):
    resolutions: list[dict] = []
    monkeypatch.delenv("MODEL_API_KEY", raising=False)

    with pytest.raises(content.ImageGenError):
        content.generate_image(
            "safe visual description", invocation=IMAGE_INVOCATION,
            budget_reserver=lambda _item: None, budget_resolver=resolutions.append,
        )

    assert resolutions[0]["outcome"] == "not_invoked"


def test_image_generation_marks_reservation_uncertain_after_provider_dispatch(meta_api):
    resolutions: list[dict] = []
    meta_api["responses"].append(httpx.ReadTimeout("timeout"))

    with pytest.raises(content.ImageGenError):
        content.generate_image(
            "safe visual description", invocation=IMAGE_INVOCATION,
            budget_reserver=lambda _item: None, budget_resolver=resolutions.append,
        )

    assert resolutions[0]["outcome"] == "uncertain"


def test_image_generation_marks_empty_provider_response_uncertain(meta_api):
    resolutions: list[dict] = []
    meta_api["responses"].append(httpx.Response(200, json={"data": []}))

    with pytest.raises(content.ImageGenError, match="returned no images"):
        content.generate_image(
            "safe visual description", invocation=IMAGE_INVOCATION,
            budget_reserver=lambda _item: None, budget_resolver=resolutions.append,
        )

    assert resolutions[0]["outcome"] == "uncertain"
