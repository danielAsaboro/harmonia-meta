"""The live probe calls every Meta model once and keeps only metadata."""

from __future__ import annotations

import json

import httpx

from harmonia_agent import meta_probe


def _handler(seen: list[httpx.Request]):
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        path = request.url.path
        if path.endswith("/responses/input_tokens"):
            return httpx.Response(200, json={"object": "response.input_tokens", "input_tokens": 31})
        if path.endswith("/responses"):
            body = json.loads(request.content)
            if body["model"] == "sam-3.1":
                return httpx.Response(200, json={"id": "resp_sam", "usage": {"video_frames_processed": 10}})
            return httpx.Response(200, headers={"x-request-id": "req-1"}, json={
                "id": "resp_1", "output_text": '{"ok": true}', "usage": {"input_tokens": 31, "output_tokens": 4},
            })
        if path.endswith("/asr/transcribe"):
            return httpx.Response(200, json={"transcript": "Harmonia is live on Meta Model API."})
        return httpx.Response(404, text="unexpected")
    return handle


def test_probe_reaches_every_model_and_records_no_content(monkeypatch):
    monkeypatch.delenv("BASETEN_API_KEY", raising=False)
    for name in ("STRATEGIST_MODEL_ID", "STRATEGIST_PROVIDER", "SEGMENTATION_MODEL_ID"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(meta_probe.meta_api, "fetch_status", lambda: {"provider": "meta", "status": "operational", "alive": True})
    monkeypatch.setattr(meta_probe, "_speech", lambda _workdir: b"RIFF")
    monkeypatch.setattr(meta_probe, "_clip", lambda _workdir: b"\x00\x00\x00\x18ftypmp42")
    seen: list[httpx.Request] = []

    with httpx.Client(transport=httpx.MockTransport(_handler(seen)), base_url="https://api.meta.ai/v1") as client:
        report = meta_probe.run_probe(client=client)

    checks = {(check["check"], check.get("model")) for check in report["checks"]}
    assert {
        ("responses", "muse-spark-1.3"), ("responses", "muse-wonder-1.0"),
        ("count_input_tokens", "muse-wonder-1.0"), ("transcribe", "muse-voice-transcribe-1.0"),
        ("segment_video", "sam-3.1"),
    } <= checks
    assert report["passed"] is True
    responses = next(check for check in report["checks"] if check["check"] == "responses")
    assert responses["requestId"] == "req-1" and responses["usage"] == {"input_tokens": 31, "output_tokens": 4}
    assert "Harmonia is live" not in json.dumps(report)
    assert not any(request.url.path.endswith("/images/generations") for request in seen)


def test_a_failed_call_fails_the_probe_with_its_status(monkeypatch):
    monkeypatch.setattr(meta_probe.meta_api, "fetch_status", lambda: {"provider": "meta", "status": "operational", "alive": True})
    monkeypatch.setattr(meta_probe, "_speech", lambda _workdir: b"RIFF")
    monkeypatch.setattr(meta_probe, "_clip", lambda _workdir: b"\x00")

    def handle(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, json={"error": {"message": "invalid key"}})

    with httpx.Client(transport=httpx.MockTransport(handle), base_url="https://api.meta.ai/v1") as client:
        report = meta_probe.run_probe(client=client)

    assert report["passed"] is False
    assert {check.get("httpStatus") for check in report["checks"] if check["check"] == "responses"} == {401}
