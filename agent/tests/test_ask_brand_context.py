import asyncio
import json

import pytest
from fastapi.testclient import TestClient

from harmonia_agent import agents, ask_api, main
from harmonia_agent.agent_models import LiaisonAnswer, LiaisonInput
from harmonia_agent.team_runtime import _specialist_prompt_payload

HEADERS = {
    "x-harmonia-internal-token": "test-token-not-a-secret",
    "x-workspace-id": "workspace-1", "x-brand-id": "brand-1", "x-user-id": "user-1",
}
BRAND = "Company: Acme. Positioning: Five-minute client reports\nCustomer agency-owners (Agency owners) pains: Reporting eats a day\nVoice: Numbers first"


def test_liaison_prompt_carries_the_brief_only_when_present():
    with_brief = _specialist_prompt_payload(LiaisonInput(question="who are our customers?", brandContext=BRAND).model_dump(mode="json"))
    assert with_brief == {"question": "who are our customers?", "brandContext": BRAND}
    without = LiaisonInput(question="who are our customers?")
    assert without.model_dump(mode="json") == {"question": "who are our customers?"}
    assert without.model_dump_json() == '{"question":"who are our customers?"}'


def test_liaison_input_bounds_the_brief():
    with pytest.raises(ValueError):
        LiaisonInput(question="q", brandContext="x" * 1501)
    with pytest.raises(ValueError):
        LiaisonInput(question="q", brandContext="")


def test_ask_with_team_sends_the_brief_to_nova(monkeypatch):
    seen = {}

    async def run(specialist, payload, *, invocation=None):
        seen["specialist"] = specialist
        seen["prompt"] = json.dumps(_specialist_prompt_payload(payload.model_dump(mode="json")))
        return {}

    monkeypatch.setattr(agents, "_run_coordinator", run)
    monkeypatch.setattr(agents, "_validated_liaison_state", lambda _state: LiaisonAnswer.model_construct(answer="ok"))
    answer, _activity = asyncio.run(agents.ask_with_team_detailed("who are our customers?", brand_context=BRAND))
    assert answer == "ok"
    assert seen["specialist"] == "nova_liaison"
    assert json.loads(seen["prompt"]) == {"question": "who are our customers?", "brandContext": BRAND}


def test_ask_endpoint_passes_the_brief_through(monkeypatch):
    calls = []

    async def ask(question, *, brand_context=None, invocation):
        calls.append((question, brand_context))
        return "ok", []

    monkeypatch.setattr(ask_api, "ask_with_team_detailed", ask)
    client = TestClient(main.app)
    assert client.post("/internal/agent/ask", json={"question": "q", "brandContext": BRAND}, headers=HEADERS).status_code == 200
    assert client.post("/internal/agent/ask", json={"question": "q"}, headers=HEADERS).status_code == 200
    assert client.post("/internal/agent/ask", json={"question": "q", "brandContext": "x" * 1501}, headers=HEADERS).status_code == 422
    assert calls == [("q", BRAND), ("q", None)]
