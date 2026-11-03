from __future__ import annotations

import asyncio

import pytest

from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from harmonia_agent.agent_models import AnalystInput, ContentDraft, EditorialReviewInput
from harmonia_agent.agents import _run_coordinator
from harmonia_agent.agents import RoleModelInstances
from harmonia_agent.role_models import RoleModelConfig
from harmonia_agent.usage import InvocationContext, run_metered
from harmonia_agent.telemetry import configure_telemetry
from harmonia_agent.team_runtime import AgentEngineProviderError
from test_agent_team import ManagedRuntime, ScriptedDraftModel, _analysis, _production_input
from harmonia_agent.tenant_context import tenant_scope
from tests.test_ryan_strategy import strategy as _content_strategy


def _analyst_input(*, media: bool = False) -> AnalystInput:
    digest = "a" * 64
    return AnalystInput.model_validate({
        "sourceIds": ["source-1"], "sourceKind": "video",
        "sourceDigest": digest, "title": "Demo",
        "sourceSegments": [{"id": "segment-1", "sourceId": "source-1", "text": "proof We cut nine days to forty hours.", "digest": "b" * 64,
                            "locator": {"kind": "time_range", "startMs": 0, "endMs": 30_000}}],
        "performanceObservations": [], "memoryFacts": [],
    })


def test_model_call_reserves_budget_before_provider():
    order: list[str] = []

    def reserve(payload):
        assert payload["operationId"] == "j1:draft:nimi:0"
        order.append("reserve")

    async def invoke():
        order.append("model")
        return "validated-result", {"id": "usage-1"}

    def finalize(payload):
        assert payload == {"id": "usage-1"}
        order.append("usage")

    result = asyncio.run(run_metered(
        reservation={"operationId": "j1:draft:nimi:0"},
        reserve=reserve,
        invoke=invoke,
        finalize=finalize,
    ))

    assert result == "validated-result"
    assert order == ["reserve", "model", "usage"]


def test_draft_run_reserves_and_reports_each_participating_role():
    reservations: list[dict] = []
    reports: list[dict] = []
    model = ScriptedDraftModel(model="muse-spark-1.3")
    payload = _production_input()

    state = asyncio.run(_run_coordinator(
        "noni_copywriter",
        payload,
        model=model,
        team_runtime=ManagedRuntime(),
        invocation=InvocationContext(
            workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
            job_id="job-1", stage="draft", operation_id="job-1:draft:0",
        ),
        budget_reserver=reservations.append,
        usage_reporter=reports.append,
    ))
    draft = ContentDraft.model_validate(state["copywriter_draft"])
    asyncio.run(_run_coordinator(
        "dara_editor", EditorialReviewInput(copywriterInput=payload, draft=draft),
        model=model, team_runtime=ManagedRuntime(),
        invocation=InvocationContext(workspace_id="workspace-test", brand_id="brand-test", user_id="user-test", job_id="job-1", stage="draft", operation_id="job-1:draft:0:dara"),
        budget_reserver=reservations.append, usage_reporter=reports.append,
    ))

    assert [item["role"] for item in reservations] == [
        "noni_copywriter", "dara_editor",
    ]
    assert [item["role"] for item in reports] == [
        "noni_copywriter", "dara_editor",
    ]
    trace_ids = {item["traceId"] for item in reports}
    assert len(trace_ids) == 2
    assert "0" * 32 not in trace_ids


def test_managed_agent_run_projects_log_trace_and_metric_activity():
    activity = []
    invocation = InvocationContext(
        workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
        job_id="job-1", stage="understand", operation_id="job-1:understand:0",
    )
    asyncio.run(_run_coordinator(
        "nimi_analyst", _analyst_input(), model="muse-spark-1.3",
        team_runtime=ManagedRuntime(), invocation=invocation,
        budget_reserver=lambda _item: None, usage_reporter=lambda _item: None,
        activity_reporter=activity.append,
    ))

    assert {item.signalType for item in activity} == {"log", "trace", "metric"}
    assert all(item.agent == "nimi_analyst" for item in activity)
    assert all(item.workspaceId == "workspace-test" for item in activity)
    assert all(item.outcome == "success" for item in activity)


def test_team_does_not_dispatch_when_the_specialist_reservation_fails():
    resolutions: list[dict] = []
    calls = 0

    def reserve(_payload):
        nonlocal calls
        calls += 1
        raise RuntimeError("budget service unavailable")

    with pytest.raises(RuntimeError, match="budget service unavailable"):
        asyncio.run(_run_coordinator(
            "noni_copywriter",
            _production_input(),
            model=ScriptedDraftModel(model="muse-spark-1.3"),
            team_runtime=ManagedRuntime(),
            invocation=InvocationContext(
                workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
                job_id="job-1", stage="draft", operation_id="job-1:draft:0",
            ),
            budget_reserver=reserve,
            budget_resolver=resolutions.append,
        ))

    assert calls == 1
    assert resolutions == []


def test_team_quarantines_all_reservations_when_runtime_fails_after_dispatch():
    class FailingRuntime:
        async def invoke(self, **_kwargs):
            raise TimeoutError("managed runtime timeout")

    resolutions: list[dict] = []
    with pytest.raises(AgentEngineProviderError, match="operation timeout") as raised:
        asyncio.run(_run_coordinator(
            "nimi_analyst",
            _analyst_input(),
            model="muse-spark-1.3",
            team_runtime=FailingRuntime(),
            invocation=InvocationContext(
                workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
                job_id="job-1", stage="understand", operation_id="job-1:understand:0",
            ),
            budget_reserver=lambda _payload: None,
            budget_resolver=resolutions.append,
        ))

    assert raised.value.status == 504

    assert [item["operationId"] for item in resolutions] == [
        "job-1:understand:0:nimi_analyst",
    ]
    assert {item["outcome"] for item in resolutions} == {"uncertain"}


def test_agent_trace_has_safe_delegation_model_and_validation_spans():
    exporter = InMemorySpanExporter()
    configure_telemetry(exporter=exporter, force=True)
    payload = _production_input().model_copy(update={"brandContext": "private voice instructions"})

    asyncio.run(_run_coordinator(
        "noni_copywriter",
        payload,
        model=ScriptedDraftModel(model="muse-spark-1.3"),
        team_runtime=ManagedRuntime(),
        invocation=InvocationContext(
            workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
            job_id="job-1", stage="draft", operation_id="job-1:draft:0",
        ),
        budget_reserver=lambda _item: None,
        usage_reporter=lambda _item: None,
    ))

    spans = exporter.get_finished_spans()
    names = [span.name for span in spans]
    assert "harmonia.agent.invoke" in names
    assert "harmonia.output.validate" in names
    invoke = next(span for span in spans if span.name == "harmonia.agent.invoke")
    assert any(event.name == "harmonia.agent.delegate" for event in invoke.events)
    serialized = " ".join(
        [span.name for span in spans]
        + [str(span.attributes) for span in spans]
        + [str(event.attributes) for span in spans for event in span.events]
    )
    assert "private voice instructions" not in serialized
    assert "Original" not in serialized
    assert "Reviewed" not in serialized


def test_heterogeneous_draft_usage_keeps_each_actual_meta_role_model():
    reservations: list[dict] = []
    reports: list[dict] = []

    models = RoleModelInstances(
        coordinator=ScriptedDraftModel(model="muse-spark-1.2"),
        strategist=ScriptedDraftModel(model="muse-spark-1.3"),
        analyst=ScriptedDraftModel(model="muse-spark-1.3"),
        copywriter=ScriptedDraftModel(model="muse-spark-1.3"),
        editor=ScriptedDraftModel(model="muse-spark-1.3"),
        planner=ScriptedDraftModel(model="muse-spark-1.2"),
        presenter=ScriptedDraftModel(model="muse-spark-1.3"),
        liaison=ScriptedDraftModel(model="muse-spark-1.3"),
        configs={
            "noni_copywriter": RoleModelConfig(
                role="noni_copywriter",
                provider="meta",
                model_id="muse-spark-1.3",
                max_output_tokens=2048,
            ),
        },
    )

    state = asyncio.run(_run_coordinator(
        "noni_copywriter",
        _production_input(),
        models=models,
        team_runtime=ManagedRuntime(),
        invocation=InvocationContext(
            workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
            job_id="job-1", stage="draft", operation_id="job-1:draft:0",
        ),
        budget_reserver=reservations.append,
        usage_reporter=reports.append,
    ))
    draft = ContentDraft.model_validate(state["copywriter_draft"])
    asyncio.run(_run_coordinator(
        "dara_editor", EditorialReviewInput(copywriterInput=_production_input(), draft=draft),
        models=models, team_runtime=ManagedRuntime(),
        invocation=InvocationContext(workspace_id="workspace-test", brand_id="brand-test", user_id="user-test", job_id="job-1", stage="draft", operation_id="job-1:draft:0:dara"),
        budget_reserver=reservations.append, usage_reporter=reports.append,
    ))

    expected = {"noni_copywriter": "muse-spark-1.3", "dara_editor": "muse-spark-1.3"}
    assert {item["role"]: item["model"] for item in reservations} == expected
    assert {item["role"]: item["model"] for item in reports} == expected
    noni_usage = next(item for item in reports if item["role"] == "noni_copywriter")
    assert noni_usage["unitType"] == "tokens"


def test_multimodal_source_uri_is_not_exported_in_trace_content():
    exporter = InMemorySpanExporter()
    configure_telemetry(exporter=exporter, force=True)
    source = "https://www.youtube.com/watch?v=abc12345678"

    with tenant_scope("workspace-test", "brand-test"):
        asyncio.run(_run_coordinator(
            "nimi_analyst",
            _analyst_input(media=True),
            model="gemini-test",
            team_runtime=ManagedRuntime(),
        ))

    serialized = " ".join(
        [str(span.attributes) for span in exporter.get_finished_spans()]
        + [
            str(event.attributes)
            for span in exporter.get_finished_spans()
            for event in span.events
        ]
    )
    assert source not in serialized


def test_managed_runtime_finalizes_explicit_estimated_usage_for_every_reserved_role():
    class ManagedRuntime:
        async def invoke(self, **_kwargs):
            return {
                "source_analysis": {
                    "sourceDigest": "a" * 64, "summary": "managed",
                    "moments": [{"id": "m1", "title": "proof", "startSec": 0, "endSec": 1,
                                 "hook": "proof", "quote": "proof", "sourceSegmentRefs": ["segment-1"],
                                 "visualEvidenceIds": [], "assumptions": [], "confidence": "high"}],
                    "angles": [], "assumptions": [], "confidence": "high",
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

    reservations: list[dict] = []
    reports: list[dict] = []
    asyncio.run(_run_coordinator(
        "nimi_analyst",
        _analyst_input(),
        model="muse-spark-1.3",
        invocation=InvocationContext(
            workspace_id="workspace-test", brand_id="brand-test", user_id="user-test",
            job_id="job-1", stage="understand", operation_id="job-1:understand:0",
        ),
        team_runtime=ManagedRuntime(),
        budget_reserver=reservations.append,
        usage_reporter=reports.append,
    ))

    assert [item["role"] for item in reports] == [
        "nimi_analyst",
    ]
    assert all(item["unitType"] == "tokens" for item in reports)
    assert all(item.get("observedCostUsd") is None for item in reports)
