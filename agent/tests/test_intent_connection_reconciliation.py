from __future__ import annotations

import asyncio

import pytest

from harmonia_agent import agents
from harmonia_agent.agent_errors import AgentContractError
from harmonia_agent.handoff_protocol import repair_request
from harmonia_agent.intent_routing import IntentRoutingInput


def test_natural_channel_mention_gets_live_connection_guidance(monkeypatch):
    async def run(*args, **kwargs):
        return {"intent_classification": {
            "intent": "establish_strategy",
            "userOutcome": "Build a founder-led content program for next month",
            "sourceUrls": [],
            "outputConcepts": ["professional_post", "calendar"],
            "platformRecommendations": ["linkedin"],
            "assumptions": [],
            "needsClarification": True,
            "clarifyingQuestion": "What does your startup do, and who should the content reach?",
            "requiresRightsAttestation": False,
            "effectRequested": False,
            "jobId": None,
        }}

    monkeypatch.setattr(agents, "_run_coordinator", run)
    monkeypatch.setattr(agents.web_client, "get_platform_connections", lambda: [
        {"id": "linkedin", "connected": False},
        {"id": "x", "connected": True},
    ])
    value = IntentRoutingInput.model_validate({
        "message": "Can you help me with social media?",
        "attachmentCount": 0,
        "workspaceContext": {
            "strategyReady": False, "planReady": False, "calendarReady": False,
            "pendingApprovalCount": 0, "goals": [], "channels": [],
            "strategySummary": None, "planSummary": None,
            "upcomingItemCount": 0, "recentJobs": [],
        },
    })

    route = asyncio.run(agents.route_intent_with_team(value))

    assert route.intent == "establish_strategy"
    assert route.platformRecommendations == ["linkedin"]
    assert route.connectionSuggestions == ["linkedin"]


def test_operational_strategy_command_cannot_be_downgraded_to_conversation(monkeypatch):
    value = IntentRoutingInput.model_validate({
        "message": "Plan the next month of founder content.",
        "attachmentCount": 0,
        "workspaceContext": {
            "strategyReady": False, "planReady": False, "calendarReady": False,
            "pendingApprovalCount": 0, "goals": [], "channels": [],
            "strategySummary": None, "planSummary": None,
            "upcomingItemCount": 0, "recentJobs": [],
        },
    })

    state = {"intent_classification": {
        "intent": "conversation",
        "userOutcome": "Plan the next month of founder content",
        "sourceUrls": [], "outputConcepts": [],
        "platformRecommendations": [],
        "assumptions": [], "needsClarification": False,
        "clarifyingQuestion": None, "requiresRightsAttestation": False,
        "effectRequested": False, "jobId": None,
    }}

    with pytest.raises(AgentContractError) as caught:
        agents._validate_run_output("harmonia_intent_router", value, state)

    assert caught.value.code == "invalid_intent_classification"
    repair = repair_request(caught.value, attempt=1)
    assert "cannot be conversation" in repair["instruction"]
    assert repair["maxAttempts"] == 2


def test_context_assembler_must_preserve_authoritative_channel():
    value = agents.StrategyContextAssemblyInput.model_validate({
        "message": "Establish our founder strategy. LinkedIn is the primary channel.",
        "recentConversation": [], "userOutcome": "Build a founder program",
        "sourceUrls": [], "outputConcepts": ["professional_post", "calendar"],
        "requestedChannels": ["linkedin"],
    })
    state = {"intent_strategy_context": {
            "company": "Harmonia", "product": "A startup content agent",
            "positioning": "Evidence-backed content operations for founders",
            "differentiators": ["Digest-bound approvals"],
            "brandVoice": ["clear"], "exclusions": [],
            "safetyConstraints": ["Never invent results"],
            "businessObjectives": ["Build qualified awareness"],
            "campaignObjectives": ["Create four weeks of founder content"],
            "audiences": [{"id": "founders", "name": "Startup founders", "pains": ["Limited time"]}],
            "funnelStage": "awareness", "intendedConversion": "Request a demo",
            "requestedChannels": ["linkedin"], "supportedChannels": ["linkedin"], "horizonWeeks": 4,
            "researchRequest": None,
        },
    }

    agents._validate_run_output("harmonia_context_assembler", value, state)

    assert state["intent_strategy_context"]["requestedChannels"] == ["linkedin"]
