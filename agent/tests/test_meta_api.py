"""Meta Model API retry transport and status probe."""

from __future__ import annotations

import asyncio

import httpx
import pytest

from harmonia_agent import meta_api
from harmonia_agent.meta_llm import MetaLlm


def _transport(statuses: list[int | tuple[int, dict[str, str]]], seen: list[httpx.Request]):
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        item = statuses.pop(0)
        status, headers = item if isinstance(item, tuple) else (item, {})
        return httpx.Response(status, headers=headers, json={"ok": status == 200})
    return handler


def test_retries_retryable_statuses_honoring_retry_after_then_succeeds():
    seen: list[httpx.Request] = []
    sleeps: list[float] = []
    transport = meta_api.RetryTransport(
        httpx.MockTransport(_transport([(429, {"retry-after": "7"}), (503, {"retry-after": "2"}), 500, 200], seen)),
        sleep=sleeps.append,
    )
    with httpx.Client(transport=transport, base_url="https://api.meta.ai/v1") as client:
        response = client.post("/responses", json={"model": "sam-3.1"})

    assert response.status_code == 200
    assert len(seen) == 4 and all(request.content == seen[0].content for request in seen)
    assert sleeps[:2] == [7.0, 2.0] and 4.0 <= sleeps[2] <= 8.0


def test_returns_non_retryable_and_final_failures_unchanged():
    for statuses, expected_calls, expected_status in (([400], 1, 400), ([429, 429, 429, 429], 4, 429), ([504], 1, 504)):
        seen: list[httpx.Request] = []
        transport = meta_api.RetryTransport(httpx.MockTransport(_transport(list(statuses), seen)), sleep=lambda _s: None)
        with httpx.Client(transport=transport) as client:
            assert client.get("https://api.meta.ai/v1/x").status_code == expected_status
        assert len(seen) == expected_calls


def test_async_transport_retries_like_the_sync_one():
    seen: list[httpx.Request] = []
    sleeps: list[float] = []

    async def sleep(seconds: float) -> None:
        sleeps.append(seconds)

    async def run() -> int:
        transport = meta_api.AsyncRetryTransport(
            httpx.MockTransport(_transport([(503, {"retry-after": "60"}), 200], seen)), sleep=sleep,
        )
        async with httpx.AsyncClient(transport=transport) as client:
            return (await client.post("https://api.meta.ai/v1/responses", json={})).status_code

    assert asyncio.run(run()) == 200
    assert sleeps == [60.0]


def test_retry_after_is_capped_and_backoff_grows():
    capped = httpx.Response(429, headers={"retry-after": "3600"})
    assert meta_api.retry_delay(capped, 1) == 60.0
    bare = httpx.Response(500)
    assert [meta_api.retry_delay(bare, n, jitter=lambda: 0.0) for n in (1, 2, 3)] == [1.0, 2.0, 4.0]


def test_client_requires_a_key_and_retries(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    with pytest.raises(RuntimeError, match="MODEL_API_KEY is required for SAM"):
        meta_api.client(5, purpose="SAM 3.1 segmentation")
    monkeypatch.setenv("MODEL_API_KEY", "k")
    with meta_api.client(5, purpose="x") as client:
        assert isinstance(client._transport, meta_api.RetryTransport)


def test_status_summarizes_live_shape_and_degraded_models():
    live = httpx.Response(200, json={
        "is_alive": True, "service_status": "operational", "service_message": "", "updated_at": "", "model_statuses": [],
    })
    assert meta_api.fetch_status(lambda _url: live) == {"provider": "meta", "status": "operational", "alive": True}
    degraded = httpx.Response(200, json={
        "is_alive": True, "service_status": "degraded", "service_message": "SAM slow",
        "model_statuses": [{"model": "sam-3.1", "status": "degraded"}, {"model": "muse-spark-1.3", "status": "operational"}],
    })
    assert meta_api.fetch_status(lambda _url: degraded) == {
        "provider": "meta", "status": "degraded", "alive": True, "degradedModels": ["sam-3.1"], "message": "SAM slow",
    }
    assert meta_api.fetch_status(lambda _url: httpx.Response(502))["status"] == "unreachable"


def test_role_models_ask_litellm_to_retry():
    model = MetaLlm(model_id="muse-spark-1.3", provider="meta", reasoning_effort="low")
    assert model._additional_args["num_retries"] == 3


def _files_client(seen: list[httpx.Request]) -> httpx.Client:
    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.method == "POST" and request.url.path.endswith("/files"):
            return httpx.Response(200, json={"id": "file-842549258569145", "object": "file"})
        return httpx.Response(200, json={"deleted": True})
    return httpx.Client(base_url="https://api.meta.ai/v1", transport=httpx.MockTransport(handler))


def test_small_video_is_sent_inline_without_an_upload():
    seen: list[httpx.Request] = []
    with _files_client(seen) as client, meta_api.video_input(client, b"\x00\x00\x00\x18ftypmp42") as part:
        assert part["type"] == "input_video" and part["video_url"].startswith("data:video/mp4;base64,")
    assert seen == []


def test_large_video_goes_through_the_files_api_and_is_deleted(monkeypatch):
    monkeypatch.setattr(meta_api, "MAX_INLINE_MEDIA_BYTES", 4)
    seen: list[httpx.Request] = []
    with _files_client(seen) as client, meta_api.video_input(client, b"0123456789") as part:
        assert part == {"type": "input_video", "file_id": "file-842549258569145"}
        upload = seen[0]
        body = upload.read()
        assert b'name="purpose"' in body and b"user_data" in body
        assert b'name="expires_after[seconds]"' in body and b"3600" in body
        assert b"0123456789" in body
    assert (seen[-1].method, seen[-1].url.path) == ("DELETE", "/v1/files/file-842549258569145")


def _count_client(handler) -> httpx.Client:
    return httpx.Client(transport=httpx.MockTransport(handler), base_url="https://api.meta.ai/v1")


def test_count_input_tokens_sends_the_exact_request_body():
    seen: list[httpx.Request] = []
    body = {"model": "muse-spark-1.3", "input": "hi", "max_output_tokens": 10}

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"object": "response.input_tokens", "input_tokens": 42})

    with _count_client(handler) as client:
        assert meta_api.count_input_tokens(client, body) == 42
    assert seen[0].url.path == "/v1/responses/input_tokens"
    assert seen[0].read() == httpx.Request("POST", "/", json=body).read()


def test_count_input_tokens_is_best_effort():
    responses = [
        httpx.Response(400, json={"error": {"message": "bad"}}),
        httpx.Response(200, json={"input_tokens": "many"}),
        httpx.Response(200, json={"input_tokens": True}),
        httpx.Response(200, json={"input_tokens": -1}),
        httpx.Response(200, content=b"not json"),
    ]
    with _count_client(lambda _request: responses.pop(0)) as client:
        assert [meta_api.count_input_tokens(client, {"model": "m"}) for _ in range(5)] == [None] * 5

    def unreachable(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("down", request=request)

    with _count_client(unreachable) as client:
        assert meta_api.count_input_tokens(client, {"model": "m"}) is None
