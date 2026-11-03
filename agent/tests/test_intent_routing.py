from __future__ import annotations

import pytest
from pydantic import ValidationError

from harmonia_agent.intent_routing import (
    IntentRoute,
    deterministic_intent_classification,
    IntentRoutingInput,
    build_intent_routing_skillset,
    source_urls_from_input,
)


def test_explicit_source_repurpose_is_host_classified_without_model_judgment():
    value = IntentRoutingInput.model_validate({
        "message": "Repurpose https://www.youtube.com/watch?v=aqz-KE-bpKQ into a LinkedIn post and exportable content package. Do not publish.",
        "attachmentCount": 0,
        "workspaceContext": {
            "strategyReady": False, "planReady": False, "calendarReady": False,
            "pendingApprovalCount": 0, "goals": [], "channels": [],
            "strategySummary": None, "planSummary": None,
            "upcomingItemCount": 0, "recentJobs": [],
        },
    })

    route = deterministic_intent_classification(value)

    assert route is not None
    assert route.intent == "repurpose_source"
    assert route.sourceUrls == ["https://www.youtube.com/watch?v=aqz-KE-bpKQ"]
    assert route.outputConcepts == ["professional_post", "content_package"]
    assert route.platformRecommendations == ["linkedin"]
    assert route.requiresRightsAttestation is True
    assert route.effectRequested is False


def context(**overrides):
    base = {
        "strategyReady": False,
        "planReady": False,
        "calendarReady": False,
        "pendingApprovalCount": 0,
        "recentJobs": [],
        "goals": [],
        "channels": [],
    }
    return {**base, **overrides}


def strategy_context():
    return {
        "company": "Harmonia",
        "product": "An autonomous content engine for startups",
        "positioning": "Turn source material into an evidence-backed content program",
        "differentiators": ["Human approval before external effects"],
        "brandVoice": ["clear", "evidence-led"],
        "exclusions": [],
        "safetyConstraints": ["Do not invent source claims"],
        "businessObjectives": ["Build awareness with startup founders"],
        "campaignObjectives": ["Create a month of useful founder content"],
        "audiences": [{"id": "startup-founders", "name": "Startup founders", "pains": ["Limited time for consistent content"]}],
        "funnelStage": "awareness",
        "intendedConversion": "Visit the website to learn more",
        "requestedChannels": ["linkedin"],
        "supportedChannels": ["linkedin"],
        "horizonWeeks": 4,
    }


def test_route_contract_accepts_normal_user_language_without_internal_tags():
    route = IntentRoute.model_validate({
        "intent": "one_off_content",
        "userOutcome": "Announce the launch to founders",
        "sourceUrls": [],
        "outputConcepts": ["short_social_post", "professional_post"],
        "platformRecommendations": ["x", "linkedin"],
        "connectionSuggestions": ["linkedin"],
        "assumptions": ["Use the approved workspace voice."],
        "needsClarification": False,
        "clarifyingQuestion": None,
        "requiresRightsAttestation": False,
        "effectRequested": False,
        "jobId": None,
        "strategyContext": None,
    })
    assert route.intent == "one_off_content"
    assert "x_post" not in route.model_dump_json()


def test_source_route_requires_strategy_context_before_starting_a_job():
    with pytest.raises(ValidationError, match="strategy context"):
        IntentRoute.model_validate({
            "intent": "establish_strategy",
            "userOutcome": "Help more startup founders discover us",
            "sourceUrls": ["https://example.com"],
            "outputConcepts": ["professional_post"],
            "platformRecommendations": ["linkedin"],
            "connectionSuggestions": [],
            "assumptions": ["Awareness is the initial funnel objective."],
            "needsClarification": False,
            "clarifyingQuestion": None,
            "requiresRightsAttestation": False,
            "effectRequested": False,
            "jobId": None,
        })


def test_source_route_carries_typed_strategy_context_from_ordinary_conversation():
    route = IntentRoute.model_validate({
        "intent": "establish_strategy",
        "userOutcome": "Help more startup founders discover us",
        "sourceUrls": ["https://example.com"],
        "outputConcepts": ["professional_post"],
        "platformRecommendations": ["linkedin"],
        "connectionSuggestions": [],
        "assumptions": ["Awareness is the initial funnel objective."],
        "needsClarification": False,
        "clarifyingQuestion": None,
        "requiresRightsAttestation": False,
        "effectRequested": False,
        "effectAuthorized": False,
        "jobId": None,
        "strategyContext": strategy_context(),
    })
    assert route.strategyContext.product == "An autonomous content engine for startups"
    assert route.strategyContext.horizonWeeks == 4


def test_route_contract_cannot_authorize_an_external_effect():
    with pytest.raises(ValidationError, match="cannot authorize"):
        IntentRoute.model_validate({
            "intent": "effect_request",
            "userOutcome": "Publish the approved launch post",
            "sourceUrls": [],
            "outputConcepts": ["short_social_post"],
            "platformRecommendations": ["x"],
            "connectionSuggestions": [],
            "assumptions": [],
            "needsClarification": False,
            "clarifyingQuestion": None,
            "requiresRightsAttestation": False,
            "effectRequested": True,
            "effectAuthorized": True,
            "jobId": None,
            "strategyContext": None,
        })


@pytest.mark.parametrize("outcome", [
    "Harmonia has accepted the source and prepared the strategy.",
    "The source was successfully repurposed into platform-native posts.",
])
def test_route_outcome_cannot_claim_work_completed_before_the_job_runs(outcome):
    with pytest.raises(ValidationError, match="desired future outcome"):
        IntentRoute.model_validate({
            "intent": "repurpose_source",
            "userOutcome": outcome,
            "sourceUrls": ["https://harmonia.example/source"],
            "outputConcepts": ["professional_post"],
            "platformRecommendations": ["linkedin"],
            "connectionSuggestions": [],
            "assumptions": [],
            "needsClarification": False,
            "clarifyingQuestion": None,
            "requiresRightsAttestation": True,
            "effectRequested": False,
            "effectAuthorized": False,
            "jobId": None,
            "strategyContext": None,
        })


def test_routing_input_is_bounded_and_workspace_context_is_typed():
    payload = IntentRoutingInput.model_validate({
        "message": "Plan next month's founder content from our current strategy",
        "workspaceContext": context(strategyReady=True, goals=["Increase qualified trials"]),
        "attachmentCount": 0,
    })
    assert payload.workspaceContext.strategyReady is True
    assert payload.workspaceContext.goals == ["Increase qualified trials"]


def test_recent_job_summary_allows_a_2000_character_evidence_summary():
    payload = IntentRoutingInput.model_validate({
        "message": "What should we do next?",
        "workspaceContext": context(recentJobs=[{
            "id": "job-1", "stage": "strategize", "status": "running", "title": "x" * 2_000,
        }]),
        "attachmentCount": 0,
    })
    assert len(payload.workspaceContext.recentJobs[0].title or "") == 2_000


def test_source_urls_are_limited_to_verbatim_operator_conversation_context():
    payload = IntentRoutingInput.model_validate({
        "message": "Please try again.",
        "workspaceContext": context(),
        "attachmentCount": 0,
        "recentConversation": [
            {"role": "user", "text": "Use https://harmonia.example/demo, please."},
            {"role": "assistant", "text": "I will use the supplied source."},
        ],
    })
    assert source_urls_from_input(payload) == ["https://harmonia.example/demo"]


def test_harmonia_routing_skill_is_loadable():
    skillset = build_intent_routing_skillset()
    assert [skill.frontmatter.name for skill in skillset.skills] == ["harmonia-intent-routing"]
    assert "internal output" in skillset.skills[0].instructions.lower()


def test_connection_tool_reports_real_safe_platform_state(monkeypatch):
    from harmonia_agent import intent_routing
    monkeypatch.setattr(intent_routing.web_client, "get_platform_connections", lambda: [
        {"id": "x", "label": "X", "connected": True, "health": "healthy"},
        {"id": "linkedin", "label": "LinkedIn", "connected": False, "health": "not_connected"},
        {"id": "google-drive", "label": "Drive", "connected": True, "health": "healthy"},
    ])
    result = intent_routing.get_social_platform_connections()
    assert result["status"] == "success"
    assert [item["id"] for item in result["data"]["platforms"]] == ["x", "linkedin"]
    assert "token" not in str(result).lower()
