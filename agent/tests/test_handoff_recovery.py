"""Shared inter-agent handoff and bounded repair contracts."""

from __future__ import annotations

import asyncio

import pytest

from harmonia_agent.agent_errors import AgentContractError
from harmonia_agent.agent_models import AnalystInput, EditorialPlannerInput
from harmonia_agent.agents import _run_coordinator, _validate_run_output, build_agent_team
from harmonia_agent.handoff_protocol import (
    HANDOFF_PROTOCOL_VERSION,
    harmonia_handoff_skill_context,
    repair_request,
)
from harmonia_agent.tenant_context import tenant_scope
from harmonia_agent.team_runtime import TeamRuntimeProviderError


def _input() -> AnalystInput:
    return AnalystInput.model_validate({
        "sourceIds": ["source-1"],
        "sourceKind": "video",
        "sourceDigest": "a" * 64,
        "title": "Demo",
        "sourceSegments": [{
            "id": "segment-1",
            "sourceId": "source-1",
            "text": "hello proof",
            "digest": "b" * 64,
            "locator": {"kind": "time_range", "startMs": 0, "endMs": 1_000},
        }],
        "performanceObservations": [],
        "memoryFacts": [],
    })


def _valid_state() -> dict:
    return {
        "source_analysis": {
            "sourceDigest": "a" * 64,
            "summary": "Grounded analysis",
            "moments": [],
            "angles": [{
                "id": "angle-1",
                "angleType": "source_insight",
                "evidenceKind": "source",
                "title": "Proof",
                "rationale": "The supplied source contains proof.",
                "evidenceRefs": ["segment-1"],
                "assumptions": [],
                "confidence": "medium",
            }],
            "assumptions": [],
            "confidence": "medium",
        },
        "nimi_analysis_skill_trace": [
            {"sequence": 1, "name": "load_skill", "args": {"skill_name": "nimi-analysis-skills"}},
            {"sequence": 2, "name": "load_skill_resource", "args": {
                "skill_name": "nimi-analysis-skills",
                "file_path": "references/evidence-observation-and-provenance.md",
            }},
        ],
        "nimi_analysis_research_trace": [],
    }


class RepairingRuntime:
    def __init__(self, *, valid_on_call: int | None = 2) -> None:
        self.calls: list[dict] = []
        self.valid_on_call = valid_on_call

    async def invoke(self, **kwargs):
        self.calls.append(kwargs)
        if self.valid_on_call is None or len(self.calls) < self.valid_on_call:
            state = _valid_state()
            state["source_analysis"]["angles"] = []
            return state
        return _valid_state()


class QuotaRecoveringRuntime:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    async def invoke(self, **kwargs):
        self.calls.append(kwargs)
        if len(self.calls) == 1:
            raise TeamRuntimeProviderError("quota exhausted", status=429)
        return _valid_state()


def test_provider_quota_failure_is_not_retried_outside_the_adk_transport() -> None:
    runtime = QuotaRecoveringRuntime()
    with tenant_scope("workspace-test", "brand-test"):
        with pytest.raises(TeamRuntimeProviderError) as raised:
            asyncio.run(_run_coordinator(
                "nimi_analyst", _input(), model="muse-test", team_runtime=runtime,
            ))

    assert raised.value.status == 429
    assert len(runtime.calls) == 1


def test_provider_failure_preserves_the_original_status_without_custom_retries() -> None:
    runtime = QuotaRecoveringRuntime()
    runtime.invoke = always_quota = _AlwaysQuota(runtime.calls)
    with tenant_scope("workspace-test", "brand-test"):
        with pytest.raises(TeamRuntimeProviderError) as raised:
            asyncio.run(_run_coordinator(
                "nimi_analyst", _input(), model="muse-test", team_runtime=runtime,
            ))

    assert raised.value.status == 429
    assert len(runtime.calls) == 1


class _AlwaysQuota:
    def __init__(self, calls: list[dict]) -> None:
        self.calls = calls

    async def __call__(self, **kwargs):
        self.calls.append(kwargs)
        raise TeamRuntimeProviderError("quota exhausted", status=429)


def test_every_agent_receives_the_shared_handoff_protocol() -> None:
    root = build_agent_team()
    agents = root.sub_agents

    assert "Harmonia inter-agent handoff" in harmonia_handoff_skill_context()
    assert "Harmonia alone advances the workflow" in harmonia_handoff_skill_context()
    assert "No specialist may skip a prerequisite" in harmonia_handoff_skill_context()
    assert "unknown external-effect outcome" in harmonia_handoff_skill_context()
    assert all(HANDOFF_PROTOCOL_VERSION in str(agent.instruction) for agent in agents)


def test_contract_mismatch_gets_a_fresh_targeted_repair_attempt() -> None:
    runtime = RepairingRuntime()
    with tenant_scope("workspace-test", "brand-test"):
        state = asyncio.run(_run_coordinator(
            "nimi_analyst", _input(), model="muse-test", team_runtime=runtime,
        ))

    assert len(runtime.calls) == 2
    assert runtime.calls[0]["payload"]["_harmonia_handoff"]["protocolVersion"] == HANDOFF_PROTOCOL_VERSION
    assert runtime.calls[0]["payload"]["_harmonia_handoff_ack"]["status"] == "accepted"
    assert runtime.calls[1]["session_key"].endswith(":repair:1")
    assert runtime.calls[1]["payload"]["_harmonia_repair"] == {
        "attempt": 1,
        "maxAttempts": 2,
        "code": "invalid_agent_output",
        "path": "output",
        "instruction": "Regenerate the complete output from the original typed input and satisfy the declared schema, evidence IDs, authority boundary, and role contract.",
    }
    assert state["_harmonia_repair"]["outcome"] == "repaired"
    assert state["_harmonia_repair"]["attemptsUsed"] == 1


def test_contract_mismatch_can_course_correct_twice_before_success() -> None:
    runtime = RepairingRuntime(valid_on_call=3)
    with tenant_scope("workspace-test", "brand-test"):
        state = asyncio.run(_run_coordinator(
            "nimi_analyst", _input(), model="muse-test", team_runtime=runtime,
        ))

    assert len(runtime.calls) == 3
    assert [call["payload"]["_harmonia_repair"]["attempt"] for call in runtime.calls[1:]] == [1, 2]
    assert runtime.calls[1]["session_key"].endswith(":repair:1")
    assert runtime.calls[2]["session_key"].endswith(":repair:2")
    assert state["_harmonia_repair"]["outcome"] == "repaired"
    assert state["_harmonia_repair"]["attemptsUsed"] == 2


def test_contract_repair_escalates_after_two_course_corrections() -> None:
    runtime = RepairingRuntime(valid_on_call=None)
    with tenant_scope("workspace-test", "brand-test"):
        with pytest.raises(AgentContractError) as raised:
            asyncio.run(_run_coordinator(
                "nimi_analyst", _input(), model="muse-test", team_runtime=runtime,
            ))

    assert len(runtime.calls) == 3
    assert [call["payload"]["_harmonia_repair"]["attempt"] for call in runtime.calls[1:]] == [1, 2]
    assert raised.value.code == "agent_output_repair_exhausted"


def test_repair_request_names_a_safe_specific_missing_handoff_requirement() -> None:
    from tests.test_temi_editorial_plan import plan, planner_input

    supplied = EditorialPlannerInput.model_validate(planner_input())
    state = {
        "editorial_plan": plan(),
        "temi_editorial_planning_trace": [
            {"sequence": 1, "name": "load_skill", "args": {
                "skill_name": "temi-editorial-planning-skills",
            }},
            {"sequence": 2, "name": "load_skill_resource", "args": {
                "skill_name": "temi-editorial-planning-skills",
                "file_path": "references/strategy-to-editorial-plan.md",
            }},
        ],
    }

    with pytest.raises(AgentContractError) as raised:
        _validate_run_output("temi_editorial_planner", supplied, state)

    assert raised.value.code == "missing_planning_snapshot_read"
    request = repair_request(
        raised.value,
        attempt=1,
        original_input=supplied.model_dump(mode="json"),
    )
    assert "request-bound planning snapshot read tool" in request["instruction"]
    assert request["requiredToolCall"] == {
        "name": "read_production_capacity",
        "args": {"snapshot_id": supplied.planningSnapshot.snapshotId},
    }
    assert supplied.planningSnapshot.snapshotId in request["instruction"]
    assert "private" not in str(request).lower()
