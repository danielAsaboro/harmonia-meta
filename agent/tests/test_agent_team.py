"""ADK team topology, contracts, and offline delegation behavior."""

from __future__ import annotations

import asyncio
import json
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from google.adk.models._capabilities import LlmCapabilities
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.adk.tools.agent_tool import AgentTool
from google.genai import types

from harmonia_agent.agent_models import (
    SourceAnalysis,
    AnalystInput,
    ContentDraft,
    CopywriterInput,
    EditorialAssessment,
    EditorialPlan,
    EditorialPlannerInput,
    EditorialReview,
    LiaisonInput,
    StrategistInput,
    StrategistResult,
)
from harmonia_agent.content_artifacts import ArtifactProductionInput, ArtifactReviewBatch, ProductionBatch
from harmonia_agent.agents import (
    AgentProtocolError,
    _recorded_web_searches,
    _reservation_payloads,
    _role_task,
    _resolve_role_models,
    _role_task,
    _run_coordinator,
    _validate_run_output,
    _validate_strategy_result,
    _validated_state,
    analyze_with_team,
    build_agent_team,
    plan_with_team,
    strategize_with_team,
    RoleModelInstances,
)
from harmonia_agent.coordinator import HarmoniaCoordinator
from harmonia_agent.agent_errors import AgentContractError
from harmonia_agent.a2ui_models import UiContext
from harmonia_agent.stages import classify_failure
from harmonia_agent.tenant_context import tenant_scope
from harmonia_agent.provider_schema import meta_output_schema
from harmonia_agent.usage import InvocationContext
from harmonia_agent.meta_search import web_search_reservation, web_search_spend
from harmonia_agent.model_catalog import estimate_text_cost
from harmonia_agent.usage import estimate_request_tokens
from tests.web_search_fixtures import search_provenance


def test_artifact_specialists_have_budget_eligibility_tasks():
    assert _role_task("noni_artifact_producer", "noni_artifact_producer", _planner_input()) == "produce_artifact_batch"
    assert _role_task("dara_artifact_editor", "dara_artifact_editor", _planner_input()) == "review_artifact_batch"


def _temi_plan():
    from tests.test_temi_editorial_plan import plan

    return plan()


def _planner_input():
    from tests.test_temi_editorial_plan import planner_input

    return planner_input()


def _analyst_input(**updates) -> AnalystInput:
    value = {
        "sourceIds": ["source-1"], "sourceKind": "video", "sourceDigest": "a" * 64,
        "title": "Demo",
        "sourceSegments": [{"id": "segment-1", "sourceId": "source-1", "text": "hello proof We cut nine days to forty hours.", "digest": "b" * 64, "locator": {"kind": "time_range", "startMs": 0, "endMs": 30_000}}],
        "performanceObservations": [], "memoryFacts": [],
    }
    value.update(updates)
    return AnalystInput.model_validate(value)


def test_nimi_semantic_validation_exposes_safe_repair_codes() -> None:
    invalid = {
        "sourceDigest": "a" * 64, "summary": "Grounded", "assumptions": [], "confidence": "medium",
        "moments": [{
            "id": "m1", "title": "Moment", "startSec": 0, "endSec": 10,
            "hook": "Hook", "quote": "Proof", "sourceSegmentRefs": ["segment-1"],
            "visualHook": "Show it", "visualEvidenceIds": [], "assumptions": ["Maybe"],
            "confidence": "high",
        }, {
            "id": "m2", "title": "Moment two", "startSec": 10, "endSec": 20,
            "hook": "Hook", "quote": "Proof", "sourceSegmentRefs": ["segment-1"],
            "visualEvidenceIds": [], "assumptions": ["Maybe"], "confidence": "high",
        }],
        "angles": [{
            "id": "a1", "angleType": "trend", "evidenceKind": "source",
            "title": "Angle", "rationale": "Reason", "evidenceRefs": ["segment-1"],
            "assumptions": [], "confidence": "medium",
        }],
    }
    with pytest.raises(AgentProtocolError) as error:
        _validated_state({"source_analysis": invalid}, "source_analysis", SourceAnalysis)
    assert "visual_evidence_pair_mismatch" in str(error.value)
    assert "confidence_assumption_conflict" in str(error.value)
    assert "angle_evidence_kind_mismatch" in str(error.value)


class ScriptedDelegationModel(BaseLlm):
    calls: list[str] = []
    media_uris: list[str] = []

    @property
    def capabilities(self) -> LlmCapabilities:
        return LlmCapabilities(output_schema_and_tools=True)

    async def generate_content_async(self, llm_request, stream=False):
        function_responses = [
            part.function_response
            for content in llm_request.contents
            for part in (content.parts or [])
            if part.function_response
        ]
        if llm_request.config.response_schema is not None:
            self.calls.append("nimi_analyst")
            self.media_uris.extend(
                part.file_data.file_uri
                for content in llm_request.contents
                for part in (content.parts or [])
                if part.file_data is not None
            )
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=(
                '{"sourceDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","summary":"Delegated analysis","moments":[{"id":"m1","title":"Proof","startSec":0,"endSec":30,"hook":"hello","quote":"hello","sourceSegmentRefs":["segment-1"],"visualEvidenceIds":[],"assumptions":[],"confidence":"high"}],"angles":[{"id":"a1","angleType":"source_insight","evidenceKind":"source","title":"Source proof","rationale":"The source contains proof.","evidenceRefs":["m1"],"assumptions":[],"confidence":"high"}],"assumptions":[],"confidence":"high"}'
            ))]))
            return
        if llm_request.tools_dict and not function_responses:
            self.calls.append("coordinator")
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
                function_call=types.FunctionCall(
                    name="nimi_analyst",
                    args={
                        "sourceIds": ["source-1"], "sourceKind": "video",
                        "sourceDigest": "a" * 64, "title": "Demo",
                        "sourceSegments": [{"id": "segment-1", "sourceId": "source-1", "text": "hello proof We cut nine days to forty hours.", "digest": "b" * 64, "locator": {"kind": "time_range", "startMs": 0, "endMs": 30000}}],
                        "performanceObservations": [], "memoryFacts": [],
                    },
                ),
            )]))
            return
        self.calls.append("coordinator_return")
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text="done")]))


class ScriptedDraftModel(BaseLlm):
    calls: list[str] = []

    @property
    def capabilities(self) -> LlmCapabilities:
        return LlmCapabilities(output_schema_and_tools=True)

    async def generate_content_async(self, llm_request, stream=False):
        instructions = str(llm_request.config.system_instruction)
        function_responses = [
            part.function_response
            for content in llm_request.contents
            for part in (content.parts or [])
            if part.function_response
        ]
        if llm_request.config.response_schema is not None:
            response_schema = str(llm_request.config.response_schema)
            if "strategySummary" in response_schema or "editorial plan" in instructions:
                self.calls.append("temi_editorial_planner")
                text = '{"strategySummary":"Activation lessons","items":[{"id":"c1","briefId":"brief-1","platform":"x","objective":"Teach activation speed","sourceRef":"m1","format":"text_post","priority":1}]}'
            elif "Write up to 10" in instructions:
                self.calls.append("noni_copywriter")
                text = '{"drafts":[{"id":"d1","platform":"x","momentId":"m1","text":"Original"}]}'
            else:
                self.calls.append("dara_editor")
                text = '{"drafts":[{"id":"d1","platform":"x","momentId":"m1","text":"Reviewed"}]}'
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=text)]))
            return
        if llm_request.tools_dict and not function_responses:
            self.calls.append("coordinator")
            yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
                function_call=types.FunctionCall(
                    name="flo_content_engine",
                    args={
                        "title": "Demo",
                        "analysis": _analysis().model_dump(mode="json"),
                        "brand_context": "voice: direct",
                    },
                ),
            )]))
            return
        self.calls.append("coordinator_return")
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text="done")]))


def _analysis() -> SourceAnalysis:
    return SourceAnalysis.model_validate({
        "sourceDigest": "a" * 64,
        "summary": "A useful startup lesson.",
        "moments": [{
            "id": "m1", "title": "Activation", "startSec": 1,
            "endSec": 8, "hook": "Cut the delay", "quote": "We cut nine days to forty hours.",
            "sourceSegmentRefs": ["segment-1"], "visualEvidenceIds": [],
            "assumptions": [], "confidence": "high",
        }],
        "angles": [{
            "id": "a1", "angleType": "source_insight", "evidenceKind": "source", "title": "Speed wins",
            "rationale": "The source describes activation speed.",
            "evidenceRefs": ["m1"], "assumptions": [], "confidence": "high",
        }],
        "assumptions": [], "confidence": "high",
    })


def _production_input() -> CopywriterInput:
    from tests.test_noni_contracts import original_input
    return CopywriterInput.model_validate(original_input())


class ManagedRuntime:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def invoke(self, **kwargs):
        self.calls.append(kwargs)
        if kwargs["specialist"] == "nimi_analyst":
            return {
                "source_analysis": {
                    **_analysis().model_dump(mode="json"),
                    "summary": "Delegated analysis",
                },
                "nimi_analysis_skill_trace": [
                    {"sequence": 1, "name": "load_skill", "args": {
                        "skill_name": "nimi-analysis-skills",
                    }},
                    {"sequence": 2, "name": "load_skill_resource", "args": {
                        "skill_name": "nimi-analysis-skills",
                        "file_path": "references/evidence-observation-and-provenance.md",
                    }},
                ],
                "nimi_analysis_research_trace": [],
            }
        if kwargs["specialist"] == "temi_editorial_planner":
            snapshot_id = kwargs["payload"]["planningSnapshot"]["snapshotId"]
            return {
                "editorial_plan": _temi_plan(),
                "temi_editorial_planning_trace": [
                    {"sequence": 1, "name": "load_skill", "args": {"skill_name": "temi-editorial-planning-skills"}},
                    {"sequence": 2, "name": "load_skill_resource", "args": {
                        "skill_name": "temi-editorial-planning-skills",
                        "file_path": "references/strategy-to-editorial-plan.md",
                    }},
                    {"sequence": 3, "name": "read_editorial_commitments", "args": {
                        "snapshot_id": snapshot_id,
                    }, "response": {"snapshotId": snapshot_id, "commitments": []}},
                ],
            }
        from tests.test_noni_contracts import editorial_checks, grounded_draft
        payload = kwargs["payload"]
        if kwargs["specialist"] == "noni_copywriter":
            draft = grounded_draft()
            for field in ("planId", "planDigest", "strategyDigest", "editorialItemId", "briefId"):
                draft[field] = payload[field]
            draft["audienceId"] = payload["brief"]["audienceId"]
            draft["objective"] = payload["brief"]["objective"]
            draft["funnelStage"] = payload["brief"]["funnelStage"]
            draft["ctaIntent"] = payload["brief"]["ctaIntent"]
            return {
                "copywriter_draft": draft,
                "noni_writing_skill_trace": [
                    {"sequence": 1, "name": "load_skill", "args": {"skill_name": "noni-writing-skills"}},
                    {"sequence": 2, "name": "load_skill_resource", "args": {
                        "skill_name": "noni-writing-skills",
                        "file_path": "references/hooks-and-introductions.md",
                    }},
                ],
            }
        if kwargs["specialist"] == "dara_editor":
            return {
                "editorial_assessment": {
                    "verdict": "accepted", "checks": editorial_checks(),
                    "issues": [], "resolvedIssueIds": [],
                },
                "dara_editing_skill_trace": [
                    {"sequence": 1, "name": "load_skill", "args": {
                        "skill_name": "dara-editing-skills",
                    }},
                    {"sequence": 2, "name": "load_skill_resource", "args": {
                        "skill_name": "dara-editing-skills",
                        "file_path": "references/editorial-triage.md",
                    }},
                ],
            }
        raise AssertionError(kwargs["specialist"])


def test_agent_team_exposes_specialists_and_ordered_draft_workflow():
    root = build_agent_team()

    assert isinstance(root, HarmoniaCoordinator)
    assert root.name == "harmonia_coordinator"
    assert [(a.name, a.mode) for a in root.sub_agents] == [
        ("harmonia_intent_router", "single_turn"),
        ("harmonia_context_assembler", "single_turn"),
        ("ryan_strategist", "single_turn"),
        ("ryan_research_strategist", "single_turn"),
        ("nimi_analyst", "single_turn"),
        ("nimi_research_analyst", "single_turn"),
        ("temi_editorial_planner", "single_turn"),
        ("noni_copywriter", "single_turn"),
        ("dara_editor", "single_turn"),
        ("noni_artifact_producer", "single_turn"),
        ("dara_artifact_editor", "single_turn"),
        ("maya_presenter", "single_turn"),
        ("nova_liaison", "chat"),
    ]
    assert not hasattr(root, "tools")


def test_coordinator_selects_only_the_request_bound_specialist_without_an_llm_transfer():
    root = build_agent_team()

    assert root.find_sub_agent("temi_editorial_planner").name == "temi_editorial_planner"
    assert root.find_sub_agent("unknown") is None


def test_coordinator_router_reads_only_explicit_request_bound_metadata():
    root = build_agent_team()

    assert not hasattr(root, "model")


def test_noni_is_a_focused_skill_backed_typed_specialist():
    root = build_agent_team()
    noni = next(agent for agent in root.sub_agents if agent.name == "noni_copywriter")

    assert noni.name == "noni_copywriter"
    assert noni.input_schema is CopywriterInput
    assert noni.output_schema == meta_output_schema(ContentDraft)
    assert noni.output_key == "copywriter_draft"
    assert noni.mode == "single_turn"
    assert len(noni.tools) == 2
    assert noni.tools[1].name == "noni_web_search"


def test_multiformat_noni_validated_state_accepts_authority_free_semantics():
    supplied = ArtifactProductionInput.model_validate({"outputPlanId": "plan-1", "outputPlanDigest": "a" * 64, "requests": [{"id": "output-1-newsletter", "outputType": "newsletter", "evidenceRefs": ["source-1:seg-1"]}], "evidence": [{"id": "source-1:seg-1", "text": "Proof"}], "brandContext": "Concise and factual", "constraints": [], "passType": "original", "priorBatch": None, "priorReview": None})
    state = {
        "semantic_artifact_draft": {"title": "Launch", "sourceSegmentRefs": ["source-1:seg-1"], "payloadJson": '{"kind":"newsletter","subject":"Launch","preheader":"Proof","introduction":"Intro","sections":[{"id":"s1","heading":"Proof","body":"Proof","sourceSegmentRefs":["source-1:seg-1"]}],"cta":"Try it"}'},
        "noni_writing_skill_trace": [
            {"sequence": 1, "name": "load_skill", "args": {"skill_name": "noni-writing-skills"}},
            {"sequence": 2, "name": "load_skill_resource", "args": {
                "skill_name": "noni-writing-skills", "file_path": "references/persuasion.md",
            }},
        ],
    }

    _validate_run_output("noni_artifact_producer", supplied, state)
    assert state["_noni_research_evidence"] == {}


def test_dara_is_a_focused_skill_only_review_specialist():
    root = build_agent_team()
    dara = next(agent for agent in root.sub_agents if agent.name == "dara_editor")

    assert dara.output_schema == meta_output_schema(EditorialAssessment)
    assert dara.output_key == "editorial_assessment"
    assert dara.mode == "single_turn"
    assert len(dara.tools) == 1


def test_multiformat_specialists_use_strict_batch_contracts():
    root = build_agent_team()
    noni = next(agent for agent in root.sub_agents if agent.name == "noni_artifact_producer")
    dara = next(agent for agent in root.sub_agents if agent.name == "dara_artifact_editor")
    assert noni.input_schema is ArtifactProductionInput
    assert isinstance(noni.output_schema, dict)
    assert noni.output_key == "semantic_artifact_draft"
    assert isinstance(dara.output_schema, dict)
    assert dara.output_key == "semantic_artifact_review"
    assert noni.output_schema["additionalProperties"] is False
    assert dara.output_schema["additionalProperties"] is False


def test_team_assigns_the_configured_model_to_each_role():
    def scripted(name: str) -> ScriptedDraftModel:
        return ScriptedDraftModel(model=name)

    root = build_agent_team(models=RoleModelInstances(
        coordinator=scripted("coordinator-fake"),
        strategist=scripted("strategist-fake"),
        analyst=scripted("analyst-fake"),
        copywriter=scripted("copywriter-fake"),
        editor=scripted("editor-fake"),
        planner=scripted("planner-fake"),
        presenter=scripted("presenter-fake"),
        liaison=scripted("liaison-fake"),
    ))

    assert not hasattr(root, "model")
    assert [agent.model.model for agent in root.sub_agents] == [
        "coordinator-fake",
        "coordinator-fake",
        "strategist-fake", "strategist-fake", "analyst-fake", "analyst-fake", "planner-fake", "copywriter-fake",
        "editor-fake", "copywriter-fake", "editor-fake", "presenter-fake", "liaison-fake",
    ]


def test_team_applies_each_roles_output_budget_and_reasoning_effort():
    root = build_agent_team()

    assert not hasattr(root, "generate_content_config")

    intent_router = next(agent for agent in root.sub_agents if agent.name == "harmonia_intent_router")
    assert intent_router.generate_content_config.temperature is None
    assert intent_router.generate_content_config.max_output_tokens == 4096
    assert intent_router.model.model == "openai/muse-spark-1.3"
    assert intent_router.model._additional_args["reasoning_effort"] == "low"

    analyst = next(agent for agent in root.sub_agents if agent.name == "nimi_analyst")
    assert analyst.generate_content_config.temperature is None
    assert analyst.generate_content_config.max_output_tokens == 16384
    assert analyst.tools == []
    assert "sourceDigest" not in analyst.output_schema["properties"]
    assert "sourceDigest" not in analyst.output_schema["required"]
    research_analyst = next(
        agent for agent in root.sub_agents if agent.name == "nimi_research_analyst"
    )
    assert len(research_analyst.tools) == 1
    assert research_analyst.tools[0].name == "nimi_web_search"
    assert analyst.output_schema["additionalProperties"] is False
    assert analyst.output_schema["properties"]["summary"]["maxLength"] == 2000
    assert "title" in analyst.output_schema["properties"]["angles"]["items"]["properties"]

    strategist = next(agent for agent in root.sub_agents if agent.name == "ryan_strategist")
    assert strategist.generate_content_config.max_output_tokens == 32768
    assert strategist.generate_content_config.temperature is None
    assert strategist.output_schema is not None
    assert strategist.output_key == "strategist_result"

    planner = next(agent for agent in root.sub_agents if agent.name == "temi_editorial_planner")
    copywriter = next(agent for agent in root.sub_agents if agent.name == "noni_copywriter")
    assert copywriter.generate_content_config.temperature is None
    assert copywriter.generate_content_config.max_output_tokens == 8192
    assert planner.generate_content_config.temperature is None
    assert planner.generate_content_config.max_output_tokens == 16384


def test_artifact_specialists_have_explicit_eligibility_tasks():
    payload = SimpleNamespace()
    assert _role_task("noni_artifact_producer", "noni_artifact_producer", payload) == "produce_artifact_batch"
    assert _role_task("dara_artifact_editor", "dara_artifact_editor", payload) == "review_artifact_batch"


def test_artifact_specialists_inherit_their_parent_role_provider_policy(monkeypatch):
    monkeypatch.setenv("COPYWRITER_TIMEOUT_SECONDS", "300")
    monkeypatch.setenv("EDITOR_TIMEOUT_SECONDS", "240")
    resolved = _resolve_role_models()

    producer = resolved.config_for("noni_artifact_producer")
    reviewer = resolved.config_for("dara_artifact_editor")
    assert producer.model_id == resolved.config_for("noni_copywriter").model_id
    assert producer.timeout_seconds == 300
    assert producer.max_output_tokens == 16384
    assert producer.eligible_tasks == ("produce_artifact_batch",)
    assert reviewer.model_id == resolved.config_for("dara_editor").model_id
    assert reviewer.timeout_seconds == 240
    assert reviewer.max_output_tokens == 8192
    assert reviewer.eligible_tasks == ("review_artifact_batch",)


def test_artifact_specialists_receive_coordinator_compiled_skills_without_model_loading_turns():
    root = build_agent_team()
    noni = next(agent for agent in root.sub_agents if agent.name == "noni_artifact_producer")
    dara = next(agent for agent in root.sub_agents if agent.name == "dara_artifact_editor")

    assert noni.tools == []
    assert dara.tools == []
    assert noni.before_agent_callback.__name__ == "activate_noni_artifact_skill"
    assert dara.before_agent_callback.__name__ == "activate_dara_artifact_skill"
    assert "APPROVED SKILL noni-writing-skills" in str(noni.instruction)
    assert "APPROVED SKILL dara-editing-skills" in str(dara.instruction)
    assert "do not call a loading" in str(noni.instruction)
    assert "do not call a loading" in str(dara.instruction)


def test_intent_router_receives_compiled_skill_and_host_owned_connection_lookup():
    root = build_agent_team()
    router = next(agent for agent in root.sub_agents if agent.name == "harmonia_intent_router")

    assert router.tools == []
    assert router.generate_content_config.max_output_tokens == 4096
    assert "Activation: coordinator_compiled" in str(router.instruction)
    assert "trusted routing host calls `get_social_platform_connections`" in str(router.instruction)
    assert router.output_schema["additionalProperties"] is False


def test_temi_meta_wire_schema_is_json_serializable_and_preserves_plan_fields():
    root = build_agent_team()
    planner = next(agent for agent in root.sub_agents if agent.name == "temi_editorial_planner")
    json.dumps(planner.output_schema)
    assert "items" in planner.output_schema["properties"]
    assert "selectedNextItemId" in planner.output_schema["properties"]
    assert planner.output_schema["required"] == list(planner.output_schema["properties"])


def test_research_reservations_include_web_search_queries_and_tokens():
    invocation = InvocationContext(
        workspace_id="w1", brand_id="b1", user_id="u1", job_id="j1",
        stage="understand", operation_id="j1:understand:0",
    )
    models = _resolve_role_models()
    payload = _analyst_input(researchRequest={
        "id": "analysis-research-1",
        "question": "Is activation speed a current onboarding concern?",
        "justification": "Qualify the requested current trend angle.",
    })
    plain = _reservation_payloads("nimi_analyst", _analyst_input(), invocation, models)
    research = _reservation_payloads("nimi_analyst", payload, invocation, models)
    text_cost = estimate_text_cost("muse-spark-1.3", *estimate_request_tokens(
        payload.model_dump_json(exclude_none=True), 16384,
    ))
    assert Decimal(plain[0]["estimatedCostUsd"]) < text_cost
    # Search context tokens and output, plus five queries at $2.50 per 1,000.
    assert Decimal(research[0]["estimatedCostUsd"]) == text_cost + web_search_reservation("muse-spark-1.3")
    assert web_search_reservation("muse-spark-1.3") == Decimal("0.087316")


def test_recorded_web_search_spend_bills_tokens_and_queries():
    provenance = search_provenance({
        "url": "https://example.com", "title": "Example", "supportedText": "Proof.",
    }, search_calls=2)
    state = {"nimi_analysis_research_trace": [{
        "sequence": 1, "name": "nimi_web_search", "args": {}, "response": {"research": {}, "provenance": provenance},
    }]}
    recorded = _recorded_web_searches(state)
    assert recorded == [provenance]
    # 1,200 input and 300 output tokens on muse-spark-1.3 plus two queries.
    assert web_search_spend(recorded) == Decimal("0.0015") + Decimal("0.001275") + Decimal("0.005")


def test_agent_reservations_record_exact_model_policy():
    invocation = InvocationContext(
        workspace_id="w1", brand_id="b1", user_id="u1", job_id="j1",
        stage="understand", operation_id="j1:understand:0",
    )

    reservations = _reservation_payloads(
        "nimi_analyst",
        _analyst_input(title="Synthetic"),
        invocation,
        _resolve_role_models(),
    )

    analyst = next(item for item in reservations if item["role"] == "nimi_analyst")
    assert analyst["modelPolicy"] == {
        "policyVersion": "gear-2026-11-03",
        "pricingVersion": "2026-11-03",
        "provider": "meta",
        "reasoningEffort": "medium",
        "safetyProfile": "harmonia-standard",
            "maxOutputTokens": 16384,
        "timeoutSeconds": 120,
        "eligibleTasks": ["analyze_media", "analyze_sources"],
        "minimumPassRate": "0.95",
    }


def test_coordinator_really_delegates_and_forwards_specialist_state():
    runtime = ManagedRuntime()
    with tenant_scope("workspace-test", "brand-test"):
        state = asyncio.run(_run_coordinator(
            "nimi_analyst",
            _analyst_input(),
            model="muse-test",
            team_runtime=runtime,
        ))

    result = _validated_state(state, "source_analysis", SourceAnalysis)
    assert result.summary == "Delegated analysis"
    assert runtime.calls[0]["specialist"] == "nimi_analyst"
    assert runtime.calls[0]["user_id"] == "workspace-test:system:proactive"


def test_analyst_receives_source_video_as_typed_time_range_evidence():
    runtime = ManagedRuntime()
    with tenant_scope("workspace-test", "brand-test"):
        asyncio.run(_run_coordinator(
            "nimi_analyst",
            _analyst_input(),
            model="muse-test",
            team_runtime=runtime,
        ))

    assert runtime.calls[0]["payload"]["sourceSegments"][0]["locator"] == {"kind": "time_range", "startMs": 0, "endMs": 30_000}


def test_temi_runs_as_a_distinct_skill_backed_typed_specialist():
    root = build_agent_team()
    planner = next(agent for agent in root.sub_agents if agent.name == "temi_editorial_planner")

    assert planner.input_schema is EditorialPlannerInput
    assert isinstance(planner.output_schema, dict)
    assert planner.tools == []
    assert planner.before_agent_callback.__name__ == "bootstrap_temi_trace"
    assert "write final post" in " ".join(planner.instruction.split())


def test_temi_prompt_bounds_the_vertical_slice_response():
    from harmonia_agent.role_models import load_role_model_catalog
    from harmonia_agent.temi_prompt import TEMI_EDITORIAL_PLANNER_INSTRUCTION

    assert "Harmonia has already activated" in TEMI_EDITORIAL_PLANNER_INSTRUCTION
    assert "no loader or read tool is exposed" in TEMI_EDITORIAL_PLANNER_INSTRUCTION
    assert "exact typed request payload" in TEMI_EDITORIAL_PLANNER_INSTRUCTION
    assert "Return exactly one plan item" in TEMI_EDITORIAL_PLANNER_INSTRUCTION
    assert "Use only low, medium, or high" in TEMI_EDITORIAL_PLANNER_INSTRUCTION
    assert load_role_model_catalog().planner.max_output_tokens == 16384


def test_temi_delegation_validates_the_returned_plan():
    runtime = ManagedRuntime()
    supplied = EditorialPlannerInput.model_validate(_planner_input())
    with tenant_scope("workspace-test", "brand-test"):
        state = asyncio.run(_run_coordinator(
            "temi_editorial_planner", supplied, model="muse-test", team_runtime=runtime,
        ))

    assert _validated_state(state, "editorial_plan", EditorialPlan).planId == "plan-job-1-v1"
    assert runtime.calls[0]["specialist"] == "temi_editorial_planner"


def test_missing_agent_state_is_a_permanent_protocol_failure():
    with pytest.raises(AgentProtocolError, match="required state key"):
        _validated_state({}, "source_analysis", SourceAnalysis)
    assert classify_failure(AgentProtocolError("bad structured output")) is True
    from tests.test_noni_contracts import grounded_draft
    invalid_payload = grounded_draft()
    invalid_payload["text"] = "x" * 281
    with pytest.raises(ValidationError) as invalid:
        ContentDraft.model_validate(invalid_payload)
    assert classify_failure(invalid.value) is True


def test_invalid_agent_state_reports_only_safe_schema_locations():
    secret = "private source text must never enter diagnostics"

    with pytest.raises(AgentProtocolError) as raised:
        _validated_state(
            {"source_analysis": {"summary": secret, "moments": [], "angles": [], "assumptions": [], "confidence": "medium"}},
            "source_analysis",
            SourceAnalysis,
        )

    assert "sourceDigest:missing" in str(raised.value)
    assert secret not in str(raised.value)


def test_specialist_contract_failure_logs_the_safe_validator_cause(caplog):
    payload = UiContext(
        runId="run-1", operatorRequest="show progress", intent="status",
    )

    with pytest.raises(AgentContractError):
        _validate_run_output(
            "maya_presenter",
            payload,
            {"surface_plan": {"surfaces": [{"private": "do not log me"}]}},
        )

    assert "surfaces.0.slot:missing" in caplog.text
    assert "do not log me" not in caplog.text


def test_adk_output_formatter_bypasses_domain_tool_guards_and_traces():
    root = build_agent_team()
    tool = SimpleNamespace(name="set_model_response")

    for name in (
        "ryan_strategist", "nimi_analyst", "temi_editorial_planner",
        "noni_copywriter", "dara_editor", "noni_artifact_producer",
        "dara_artifact_editor",
    ):
        agent = next(item for item in root.sub_agents if item.name == name)
        context = SimpleNamespace(state={
            "ryan_strategy_skill_trace": [],
            "nimi_analysis_skill_trace": [],
            "nimi_analysis_research_trace": [],
            "temi_editorial_planning_trace": [],
            "noni_writing_skill_trace": [],
            "dara_editing_skill_trace": [],
        })
        if agent.before_tool_callback:
            agent.before_tool_callback(tool, {}, context)
        if agent.after_tool_callback:
            agent.after_tool_callback(tool, {}, context, {"accepted": True})

        assert all(value == [] for value in context.state.values())


def test_maya_uses_a_meta_strict_wire_schema_before_strict_validation():
    presenter = next(
        item for item in build_agent_team().sub_agents if item.name == "maya_presenter"
    )

    assert isinstance(presenter.output_schema, dict)
    assert presenter.output_schema["required"] == ["version", "surfaces"]
    assert presenter.output_schema["additionalProperties"] is False
    assert "const" not in json.dumps(presenter.output_schema)
    assert "$defs" not in json.dumps(presenter.output_schema)
    assert "$ref" not in json.dumps(presenter.output_schema)
    assert "default" not in json.dumps(presenter.output_schema)
    assert presenter.output_schema["properties"]["version"]["enum"] == ["harmonia.ui/v1"]
    surface = presenter.output_schema["properties"]["surfaces"]["items"]
    refs = surface["properties"]["nodes"]["items"]["properties"]["refs"]
    assert refs["required"] == list(refs["properties"])
    assert refs["properties"]["draftIds"]["type"] == "array"


def test_liaison_must_return_grounded_answer_contract():
    with pytest.raises(AgentContractError, match="Nova returned output"):
        _validate_run_output("nova_liaison", LiaisonInput(question="what is pending?"), {})
    with pytest.raises(AgentContractError, match="Nova returned output"):
        _validate_run_output("nova_liaison", LiaisonInput(question="q"), {"liaison_answer": "   "})
    envelope = {"status": "success", "data": {"found": True}, "error": None,
                "evidence": [{"evidenceId": "ev-aaaaaaaaaaaaaaaa", "source": "harmonia_firestore_job", "provenance": "live"}]}
    _validate_run_output(
        "nova_liaison",
        LiaisonInput(question="q"),
        {"liaison_answer": '{"status":"success","answer":"Job exists [ev-aaaaaaaaaaaaaaaa].","skillName":"job-status","claims":[{"text":"Job exists","evidenceIds":["ev-aaaaaaaaaaaaaaaa"]}],"error":null,"uncertainty":[]}',
         "liaison_tool_trace": [
             {"sequence": 1, "name": "load_skill", "args": {"skill_name": "job-status"}, "response": {}},
             {"sequence": 2, "name": "get_job_status", "args": {"job_id": "job-1"}, "response": envelope},
         ]},
    )


def test_temi_run_output_rejects_an_unknown_brief():
    supplied = EditorialPlannerInput.model_validate(_planner_input())
    invalid = _temi_plan()
    invalid["items"][0]["briefId"] = "brief-invented"
    with pytest.raises(AgentContractError, match="Temi returned output"):
        _validate_run_output(
            "temi_editorial_planner", supplied, {"editorial_plan": invalid},
        )
