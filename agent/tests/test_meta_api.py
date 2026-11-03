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
