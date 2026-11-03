"""Meta Model API web search over the Responses API, exercised with a mock transport."""

from __future__ import annotations

import asyncio
import json
import pickle
from types import SimpleNamespace

import httpx
import pytest

from harmonia_agent import meta_search
from harmonia_agent.meta_llm import MetaLlm
from harmonia_agent.meta_search import (
    MetaWebSearchError,
    MetaWebSearchTool,
    require_cited_source,
    run_web_search,
    search_model_id,
    search_response,
)
from harmonia_agent.provider_schema import meta_output_schema
from harmonia_agent.ryan_skills import GroundedStrategyResearch, build_ryan_web_search_tool

_RESEARCH = {
    "requestId": "research-1",
    "query": "governed content operations",
    "sources": [{
        "evidenceId": "search-1",
        "title": "Governed content operations",
        "url": "https://example.com/ops",
        "supportedText": "Approval gates reduce publishing errors.",
    }],
}


def _response_body(*, research: dict = _RESEARCH, status: str = "completed") -> dict:
    text = json.dumps(research)
    start = text.find("Approval")
    end = start + len("Approval gates reduce publishing errors.") if start >= 0 else 0
    return {
        "id": "resp_123",
        "object": "response",
        "status": status,
        "model": "muse-spark-1.3",
        "output": [
            {"id": "ws_1", "type": "web_search_call", "status": "completed", "results": [{
                "type": "text_result",
                "title": "Governed content operations",
                "url": "https://example.com/ops",
                "snippet": "Teams found that approval gates reduce publishing errors.",
            }]},
            {"id": "ws_2", "type": "web_search_call", "status": "completed"},
            {"id": "msg_1", "type": "message", "role": "assistant", "status": "completed", "content": [{
                "type": "output_text",
                "text": text,
                "annotations": [{
                    "type": "url_citation",
                    "url": "https://example.com/ops",
                    "title": "Governed content operations",
                    "start_index": max(start, 0),
                    "end_index": end,
                }],
            }]},
        ],
        "usage": {"input_tokens": 4200, "output_tokens": 350, "total_tokens": 4550},
    }


def _mock(monkeypatch, handler) -> list[httpx.Request]:
    requests: list[httpx.Request] = []

    def record(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return handler(request)

    monkeypatch.setattr(
        meta_search, "_http_client",
        lambda: httpx.AsyncClient(transport=httpx.MockTransport(record)),
    )
    return requests


def _run(**overrides):
    return asyncio.run(run_web_search(**{
        "model_id": "muse-spark-1.3",
        "instructions": "Search only for the request.",
        "request": json.dumps({"id": "research-1"}),
        "output_model": GroundedStrategyResearch,
        **overrides,
    }))


def test_web_search_posts_one_responses_request_with_search_and_strict_schema(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    monkeypatch.delenv("META_API_BASE_URL", raising=False)
    requests = _mock(monkeypatch, lambda _request: httpx.Response(200, json=_response_body()))

    research, provenance = _run()

    request = requests[0]
    assert str(request.url) == "https://api.meta.ai/v1/responses"
    assert request.headers["authorization"] == "Bearer test-key"
    payload = json.loads(request.content)
    assert payload["model"] == "muse-spark-1.3"
    assert payload["tools"] == [{"type": "web_search"}]
    assert payload["include"] == ["web_search_call.results"]
    assert payload["text"]["format"] == {
        "type": "json_schema", "name": "GroundedStrategyResearch",
        "schema": meta_output_schema(GroundedStrategyResearch), "strict": True,
    }
    assert payload["store"] is False
    assert "response_format" not in payload
    assert research.model_dump(mode="json") == _RESEARCH
    assert provenance.searchCalls == 2
    assert provenance.results[0].url == "https://example.com/ops"
    assert provenance.citations[0].citedText == "Approval gates reduce publishing errors."
    assert (provenance.inputTokens, provenance.outputTokens) == (4200, 350)
    require_cited_source(
        provenance, url="https://example.com/ops", title="Governed content operations",
        supported_text="Approval gates reduce publishing errors.", label="Test",
    )


def test_web_search_reads_the_key_at_call_time_and_fails_closed_without_it(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)
    requests = _mock(monkeypatch, lambda _request: httpx.Response(200, json=_response_body()))
    with pytest.raises(RuntimeError, match="MODEL_API_KEY"):
        _run()
    assert requests == []


@pytest.mark.parametrize(("response", "message"), [
    (httpx.Response(429, json={"error": {"type": "rate_limit_error"}}), "HTTP 429"),
    (httpx.Response(200, json=_response_body(status="incomplete")), "did not complete"),
    (httpx.Response(200, json=_response_body(research={"requestId": "research-1"})), "invalid structured research"),
    (httpx.Response(200, text="not json"), "non-JSON"),
])
def test_web_search_surfaces_provider_failures(monkeypatch, response, message):
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    _mock(monkeypatch, lambda _request: response)
    with pytest.raises(MetaWebSearchError, match=message):
        _run()


def test_tool_declares_one_request_argument_and_returns_research_with_provenance(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "test-key")
    requests = _mock(monkeypatch, lambda _request: httpx.Response(200, json=_response_body()))
    tool = build_ryan_web_search_tool("muse-spark-1.3")

    declaration = tool._get_declaration()
    assert declaration.name == "ryan_web_search"
    assert list(declaration.parameters.properties) == ["request"]
    assert declaration.parameters.required == ["request"]

    result = asyncio.run(tool.run_async(
        args={"request": json.dumps({"id": "research-1"})}, tool_context=SimpleNamespace(state={}),
    ))
    assert json.loads(requests[0].content)["input"] == json.dumps({"id": "research-1"})
    research, provenance = search_response(result, label="Ryan")
    assert research == _RESEARCH
    assert provenance.responseId == "resp_123"
    with pytest.raises(ValueError, match="non-empty request"):
        asyncio.run(tool.run_async(args={}, tool_context=SimpleNamespace(state={})))


def test_tool_pickles_without_credentials(monkeypatch):
    monkeypatch.setenv("MODEL_API_KEY", "secret-never-pickled")
    tool = build_ryan_web_search_tool(MetaLlm(
        model_id="muse-spark-1.3", provider="meta", reasoning_effort="high",
    ))
    restored = pickle.loads(pickle.dumps(tool))
    assert isinstance(restored, MetaWebSearchTool)
    assert restored.model_id == "muse-spark-1.3"
    assert b"secret-never-pickled" not in pickle.dumps(tool)


def test_baseten_roles_search_on_the_default_meta_model():
    baseten = MetaLlm(
        model_id="meta-models/muse-spark-open-1026", provider="baseten", reasoning_effort="medium",
    )
    assert search_model_id(baseten) == "muse-spark-1.3"
    assert search_model_id("openai/muse-spark-1.2") == "muse-spark-1.2"
