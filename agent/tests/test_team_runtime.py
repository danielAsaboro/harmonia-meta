"""Managed Agent Engine runtime contracts."""

from __future__ import annotations

import asyncio

import pytest
from google.adk.agents import Agent
from google.adk.models._capabilities import LlmCapabilities
from google.adk.models.base_llm import BaseLlm
from google.adk.models.llm_response import LlmResponse
from google.genai import types

from harmonia_agent.team_runtime import (
    AdkTeamRuntime,
    _request_scoped_tools,
    _specialist_prompt_payload,
)
from harmonia_agent.agent_models import SourceAnalysis
from harmonia_agent.agents import _resolve_role_models
from harmonia_agent.coordinator import HarmoniaCoordinator


def test_local_specialist_prompt_excludes_runtime_only_projection() -> None:
    payload = {
        "title": "Demo",
        "transcript": "proof",
        "_durable_context_projection": {"manifestDigest": "a" * 64},
    }
    assert _specialist_prompt_payload(payload) == {
        "title": "Demo",
        "transcript": "proof",
    }


def test_nimi_research_tool_is_absent_without_a_typed_research_request() -> None:
    tools = [object()]
    assert _request_scoped_tools("nimi_analyst", {"researchRequest": None}, tools) == []
    assert _request_scoped_tools(
        "nimi_analyst", {"researchRequest": {"mode": "public_web"}}, tools,
    ) == tools


def test_deployed_specialist_selection_requires_typed_research_authority() -> None:
    from harmonia_agent.coordinator import authorized_specialist_name

    assert authorized_specialist_name("nimi_analyst", {"researchRequest": None}) == "nimi_analyst"
    assert authorized_specialist_name(
        "nimi_analyst", {"researchRequest": {"mode": "public_web"}},
    ) == "nimi_research_analyst"
    assert authorized_specialist_name("ryan_strategist", {}) == "ryan_strategist"
    assert authorized_specialist_name("ryan_strategist", {"researchRequest": {"id": "research-1"}}) == "ryan_research_strategist"


class _InvalidStructuredOutputModel(BaseLlm):
    @property
    def capabilities(self) -> LlmCapabilities:
        return LlmCapabilities(output_schema_and_tools=True)

    async def generate_content_async(self, llm_request, stream=False):
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(
            text='{"groundedMoments":[],"gapsAndCritique":[]}',
        )]))


class _ValidStructuredOutputModel(BaseLlm):
    @property
    def capabilities(self) -> LlmCapabilities:
        return LlmCapabilities(output_schema_and_tools=True)

    async def generate_content_async(self, llm_request, stream=False):
        yield LlmResponse(content=types.Content(role="model", parts=[types.Part(text=(
            '{"sourceDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",'
            '"summary":"Grounded analysis","moments":[],"angles":[{"id":"angle-1",'
            '"angleType":"source_insight","evidenceKind":"source","title":"Source proof",'
            '"rationale":"The supplied source contains a claim.","evidenceRefs":["segment-1"],'
            '"assumptions":[],"confidence":"medium"}],"assumptions":[],"confidence":"medium"}'
        ))]))


def _local_runtime(model: BaseLlm) -> AdkTeamRuntime:
    specialist = Agent(
        name="nimi_analyst", model=model, instruction="Return SourceAnalysis JSON.",
        output_schema=SourceAnalysis, output_key="source_analysis", mode="single_turn",
    )
    root = HarmoniaCoordinator(
        name="harmonia_coordinator",
        sub_agents=[specialist],
    )
    return AdkTeamRuntime(root)


def test_local_runtime_runs_valid_single_turn_specialist_under_a_workflow_root() -> None:
    state = asyncio.run(_local_runtime(_ValidStructuredOutputModel(model="valid-output")).invoke(
        specialist="nimi_analyst",
        payload={"title": "Demo"},
        user_id="workspace:user",
        session_key="job:understand:0",
    ))

    assert state["source_analysis"]["summary"] == "Grounded analysis"


def test_local_runtime_forwards_rejected_output_to_harmonia_contract_repair() -> None:
    state = asyncio.run(_local_runtime(_InvalidStructuredOutputModel(model="invalid-output")).invoke(
        specialist="nimi_analyst",
        payload={"title": "Demo"},
        user_id="workspace:user",
        session_key="job:understand:0",
    ))

    assert state["source_analysis"] == {"groundedMoments": [], "gapsAndCritique": []}


def test_role_models_bind_each_provider_endpoint_at_call_time(monkeypatch):
    monkeypatch.setenv("COORDINATOR_MODEL_ID", "muse-spark-1.2")
    monkeypatch.setenv("ANALYST_PROVIDER", "baseten")
    monkeypatch.setenv("MODEL_API_KEY", "meta-key")
    monkeypatch.setenv("BASETEN_API_KEY", "baseten-key")

    models = _resolve_role_models()

    assert models.coordinator.model == "openai/muse-spark-1.2"
    assert models.coordinator.endpoint() == ("https://api.meta.ai/v1", "meta-key")
    assert models.analyst.model == "openai/meta-models/muse-spark-open-1026"
    assert models.analyst.endpoint() == ("https://inference.baseten.co/v1", "baseten-key")


def test_role_model_call_fails_closed_without_its_api_key(monkeypatch):
    monkeypatch.delenv("MODEL_API_KEY", raising=False)

    models = _resolve_role_models()

    with pytest.raises(RuntimeError, match="MODEL_API_KEY"):
        models.coordinator.endpoint()
