from fastapi.testclient import TestClient

from harmonia_agent import intent_api, main
from harmonia_agent.intent_routing import IntentRoute
from harmonia_agent.team_runtime import AgentEngineProviderError
from harmonia_agent.agents import AgentProtocolError


def payload():
    return {
        "message": "Plan a month of founder content",
        "attachmentCount": 0,
        "workspaceContext": {
            "strategyReady": False, "planReady": False, "calendarReady": False,
            "pendingApprovalCount": 0, "goals": [], "channels": [], "recentJobs": [],
        },
    }


def test_route_endpoint_requires_internal_auth():
    response = TestClient(main.app).post("/internal/agent/route", json=payload())
    assert response.status_code == 401


def test_route_endpoint_rejects_unscoped_tenant_identifiers():
    response = TestClient(main.app).post("/internal/agent/route", json=payload(), headers={
        "x-harmonia-internal-token": "test-token-not-a-secret",
        "x-workspace-id": "../other", "x-brand-id": "brand-1", "x-user-id": "user-1",
    })
    assert response.status_code == 400


def test_route_endpoint_returns_strict_harmonia_route(monkeypatch):
    async def route(_payload, *, invocation):
        assert invocation.workspace_id == "workspace-1"
        return IntentRoute.model_validate({
            "intent": "establish_strategy", "userOutcome": "Build an ongoing content program",
            "sourceUrls": [], "outputConcepts": [], "assumptions": [],
            "platformRecommendations": [], "connectionSuggestions": [],
            "needsClarification": False, "clarifyingQuestion": None,
            "requiresRightsAttestation": False, "effectRequested": False, "jobId": None,
            "strategyContext": None,
        })

    monkeypatch.setattr(intent_api, "route_intent_with_team", route)
    response = TestClient(main.app).post("/internal/agent/route", json=payload(), headers={
        "x-harmonia-internal-token": "test-token-not-a-secret",
        "x-workspace-id": "workspace-1", "x-brand-id": "brand-1", "x-user-id": "user-1",
    })
    assert response.status_code == 200
    assert response.json()["intent"] == "establish_strategy"
    assert response.json()["effectAuthorized"] is False


def test_route_redacts_agent_engine_provider_failure(monkeypatch):
    async def unavailable(*_args, **_kwargs):
        raise AgentEngineProviderError("provider authentication details must stay private")

    monkeypatch.setattr(intent_api, "route_intent_with_team", unavailable)
    response = TestClient(main.app, raise_server_exceptions=False).post(
        "/internal/agent/route", json=payload(), headers={
            "x-harmonia-internal-token": "test-token-not-a-secret",
            "x-workspace-id": "workspace-1", "x-brand-id": "brand-1", "x-user-id": "user-1",
        },
    )

    assert response.status_code == 502
    assert response.json()["detail"] == {
        "code": "agent_engine_unavailable",
        "category": "dependency",
        "message": "Harmonia's reasoning service is temporarily unavailable.",
        "retryable": True,
    }


def test_route_reports_missing_managed_state_without_exposing_payload(monkeypatch):
    async def missing_state(*_args, **_kwargs):
        raise AgentProtocolError("coordinator did not produce required state key: intent_route")

    monkeypatch.setattr(intent_api, "route_intent_with_team", missing_state)
    response = TestClient(main.app, raise_server_exceptions=False).post(
        "/internal/agent/route", json=payload(), headers={
            "x-harmonia-internal-token": "test-token-not-a-secret",
            "x-workspace-id": "workspace-1", "x-brand-id": "brand-1", "x-user-id": "user-1",
        },
    )

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "agent_engine_missing_route_state"
