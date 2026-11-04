"""The MCP server exposes three tools and speaks to Harmonia only with the operator's token."""

from __future__ import annotations

import asyncio
import json

import httpx
import pytest

from harmonia_agent import mcp_server


def _fake(seen: list[httpx.Request]):
    def handle(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        if request.url.path == "/api/chat":
            return httpx.Response(200, json={"intent": "create_job", "reply": "Started a campaign.",
                                              "job": {"id": "job-1", "stage": "collect_sources", "status": "running"},
                                              "pendingActions": []})
        if request.url.path == "/api/jobs":
            return httpx.Response(200, json={"jobs": [{"id": "job-1", "stage": "strategize", "status": "awaiting_approval", "config": {"secret": "x"}}]})
        if request.url.path == "/api/jobs/job-1":
            return httpx.Response(200, json={"job": {
                "id": "job-1", "stage": "awaiting_approval", "status": "running",
                "sourceAnalysis": {"summary": "Activation story", "moments": [{"title": "Nine days to forty hours", "startSec": 12, "endSec": 19}]},
                "contentArtifacts": [{"id": "x1", "payload": {"kind": "x_post", "text": "..."}}],
                "actions": [{"title": "Publish X post", "approvalState": "pending"}, {"title": "Export pack", "approvalState": "approved"}],
            }})
        return httpx.Response(403, json={"error": "agent tokens cannot call this route"})
    return handle


@pytest.fixture()
def seen(monkeypatch):
    requests: list[httpx.Request] = []
    monkeypatch.setattr(mcp_server, "_client", lambda: httpx.Client(
        base_url="https://harmonia.test", headers={"Authorization": "Bearer hmn_test"},
        transport=httpx.MockTransport(_fake(requests)),
    ))
    return requests


def test_server_lists_exactly_the_three_tools():
    names = {tool.name for tool in asyncio.run(mcp_server.server.list_tools())}
    assert names == {"ask_harmonia", "list_campaigns", "get_campaign"}


def test_ask_sends_the_source_and_rights_attestation_with_the_token(seen):
    result = mcp_server.ask_harmonia("Turn this talk into a LinkedIn post", source_url="https://example.com/talk", i_have_rights=True)

    body = json.loads(seen[0].content)
    assert seen[0].headers["authorization"] == "Bearer hmn_test"
    assert "Source: https://example.com/talk" in body["message"]
    assert mcp_server.RIGHTS_ATTESTATION_PHRASE in body["message"]
    assert result == {"reply": "Started a campaign.", "intent": "create_job",
                      "campaign": {"id": "job-1", "stage": "collect_sources", "status": "running"}, "waitingForHumanApproval": 0}


def test_no_rights_attestation_unless_asked(seen):
    mcp_server.ask_harmonia("Summarise my last campaign")
    assert mcp_server.RIGHTS_ATTESTATION_PHRASE not in json.loads(seen[0].content)["message"]


def test_campaign_reads_are_trimmed_to_what_an_agent_needs(seen):
    assert mcp_server.list_campaigns() == [{"id": "job-1", "stage": "strategize", "status": "awaiting_approval", "controlState": None, "updatedAt": None}]
    campaign = mcp_server.get_campaign("job-1")
    assert campaign["moments"] == [{"title": "Nine days to forty hours", "startSec": 12, "endSec": 19}]
    assert campaign["waitingForHumanApproval"] == ["Publish X post"]
    assert campaign["drafts"] == [{"kind": "x_post", "id": "x1"}]


def test_a_refused_route_surfaces_as_an_error(monkeypatch, seen):
    with pytest.raises(RuntimeError, match="403"):
        mcp_server._json(httpx.Response(403, json={"error": "agent tokens cannot call this route"}))
