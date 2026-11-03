from __future__ import annotations

import asyncio

import pytest

from harmonia_agent.a2ui_models import SurfacePlan, UiContext
from harmonia_agent.a2ui_presenter import plan_surface, validate_surface_plan
from harmonia_agent.agents import AgentProtocolError, build_agent_team
from harmonia_agent.agent_errors import AgentContractError
from harmonia_agent.usage import InvocationContext


def context_fixture() -> UiContext:
    return UiContext.model_validate(
        {
            "runId": "run-1",
            "operatorRequest": "Show the strongest moments.",
            "intent": "status",
            "job": {
                "id": "job-1",
                "stage": "understand",
                "status": "running",
                "title": "Launch interview",
                "sourceKind": "video",
            },
            "drafts": [],
            "moments": [
                {"id": "moment-1", "title": "Outcome proof", "startSec": 12, "endSec": 24}
            ],
            "sources": [{"id": "source-video", "kind": "video", "label": "Source video"}],
            "assets": [],
            "actions": [],
            "receipts": [],
        }
    )


def invocation_fixture() -> InvocationContext:
    return InvocationContext(
        job_id="job-1",
        workspace_id="workspace-1",
        brand_id="brand-1",
        user_id="operator-1",
        stage="presentation",
        operation_id="present-run-1",
    )


class FakeTeamRuntime:
    def __init__(self, state: dict) -> None:
        self.state = state
        self.calls: list[dict] = []

    async def invoke(self, **kwargs):
        self.calls.append(kwargs)
        return self.state


def valid_surface_state() -> dict:
    return {
        "surface_plan": {
            "version": "harmonia.ui/v1",
            "surfaces": [
                {
                    "slot": "canvas",
                    "revision": 1,
                    "rootId": "root",
                    "artDirection": {
                        "rhythm": "cinematic",
                        "composition": "split",
                        "energy": "active",
                    },
                    "nodes": [
                        {
                            "id": "root",
                            "component": "MomentExplorer",
                            "refs": {"jobId": "job-1", "momentIds": ["moment-1"]},
                            "artDirection": {
                                "tone": "blue",
                                "role": "feature",
                                "density": "balanced",
                                "motion": "trace",
                            },
                            "children": [],
                        }
                    ],
                }
            ],
        }
    }


def test_plan_surface_uses_managed_runtime_and_validates_output() -> None:
    runtime = FakeTeamRuntime(valid_surface_state())
    reservations: list[dict] = []
    usage: list[dict] = []

    result = asyncio.run(
        plan_surface(
            context_fixture(),
            invocation=invocation_fixture(),
            team_runtime=runtime,
            budget_reserver=reservations.append,
            usage_reporter=usage.append,
        )
    )

    assert result.surfaces[0].nodes[0].component == "MomentExplorer"
    assert result.surfaces[0].artDirection.rhythm == "cinematic"
    assert result.surfaces[0].nodes[0].artDirection.tone == "blue"
    assert runtime.calls[0]["specialist"] == "maya_presenter"
    assert runtime.calls[0]["user_id"] == "workspace-1:operator-1:job-1"
    assert [record["role"] for record in reservations] == [
        "maya_presenter",
    ]
    assert [record["role"] for record in usage] == [
        "maya_presenter",
    ]


def test_plan_surface_rejects_invalid_managed_output() -> None:
    runtime = FakeTeamRuntime({"surface_plan": {"version": "harmonia.ui/v1", "surfaces": []}})

    with pytest.raises(AgentContractError, match="Maya returned output"):
        asyncio.run(
            plan_surface(
                context_fixture(),
                invocation=invocation_fixture(),
                team_runtime=runtime,
                budget_reserver=lambda _record: None,
                usage_reporter=lambda _record: None,
            )
        )


@pytest.mark.parametrize(("mutation", "message"), [
    (lambda value: value["surfaces"][0]["nodes"][0]["refs"].update(momentIds=["invented"]), "unknown moment"),
    (lambda value: value["surfaces"][0]["nodes"][0].update(component="DraftComparison", refs={"jobId": "job-1"}), "requires draftIds"),
    (lambda value: value["surfaces"][0]["nodes"][0].update(title="Published successfully"), "authority"),
])
def test_context_bound_validator_rejects_invented_incomplete_and_authoritative_plans(mutation, message) -> None:
    candidate = valid_surface_state()["surface_plan"]
    mutation(candidate)
    with pytest.raises(AgentProtocolError, match=message):
        validate_surface_plan(context_fixture(), SurfacePlan.model_validate(candidate))


def test_approval_component_requires_approval_slot_and_pending_exact_action() -> None:
    payload = context_fixture().model_dump(mode="json")
    payload["actions"] = [{"id": "action-1", "type": "publish_x_post", "pending": False}]
    candidate = {
        "version": "harmonia.ui/v1", "surfaces": [{"slot": "canvas", "revision": 1,
        "rootId": "root", "nodes": [{"id": "root", "component": "ApprovalReview",
        "refs": {"jobId": "job-1", "actionIds": ["action-1"]}, "children": []}]}],
    }
    with pytest.raises(AgentProtocolError, match="approval slot"):
        validate_surface_plan(UiContext.model_validate(payload), SurfacePlan.model_validate(candidate))
    candidate["surfaces"][0]["slot"] = "approval"
    with pytest.raises(AgentProtocolError, match="pending action"):
        validate_surface_plan(UiContext.model_validate(payload), SurfacePlan.model_validate(candidate))


def test_plan_surface_validates_managed_output_against_exact_context() -> None:
    candidate = valid_surface_state()
    candidate["surface_plan"]["surfaces"][0]["nodes"][0]["refs"]["momentIds"] = ["invented"]
    with pytest.raises(AgentProtocolError, match="unknown moment"):
        asyncio.run(plan_surface(context_fixture(), invocation=invocation_fixture(),
            team_runtime=FakeTeamRuntime(candidate), budget_reserver=lambda _record: None,
            usage_reporter=lambda _record: None))


def test_plan_surface_rejects_arbitrary_color_output() -> None:
    state = valid_surface_state()
    state["surface_plan"]["surfaces"][0]["nodes"][0]["artDirection"]["tone"] = "#00ff00"
    runtime = FakeTeamRuntime(state)

    with pytest.raises(AgentContractError, match="Maya returned output"):
        asyncio.run(
            plan_surface(
                context_fixture(),
                invocation=invocation_fixture(),
                team_runtime=runtime,
                budget_reserver=lambda _record: None,
                usage_reporter=lambda _record: None,
            )
        )


def test_presenter_instruction_defines_semantic_art_direction() -> None:
    presenter = next(agent for agent in build_agent_team().sub_agents if agent.name == "maya_presenter")
    instruction = str(presenter.instruction)

    assert "Use ink for strategy" in instruction
    assert "acid for a selected creative direction or persisted verified success" in instruction
    assert "never emit style values" in instruction
    assert "Prefer one hero or feature per surface" in instruction
