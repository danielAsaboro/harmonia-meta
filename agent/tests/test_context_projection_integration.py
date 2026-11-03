from __future__ import annotations

import asyncio

from harmonia_agent import agents
from harmonia_agent.agents import _run_coordinator
from harmonia_agent.operation_context import operation_scope
from harmonia_agent.tenant_context import tenant_scope
from harmonia_agent.usage import InvocationContext
from tests.test_agent_team import ManagedRuntime, _analyst_input


def test_event_driven_model_call_persists_projection_before_fresh_managed_session(
    monkeypatch,
) -> None:
    order = []
    artifact_ids = iter([
        "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
        "018f47a2-4f40-7b1f-b19f-8f6b916b7d12",
    ])

    def create_artifact(**kwargs):
        artifact_id = next(artifact_ids)
        order.append(("artifact", kwargs["producer"]["id"], artifact_id))
        return {"id": artifact_id, "sha256": "f" * 64}

    def save_context_projection(**kwargs):
        order.append(("projection", kwargs["manifest"]["operationEpoch"]))
        return {"id": "projection-persisted"}

    class OrderedRuntime(ManagedRuntime):
        async def invoke(self, **kwargs):
            order.append(("runtime", kwargs["session_key"]))
            return await super().invoke(**kwargs)

    monkeypatch.setattr(agents, "create_artifact", create_artifact)
    monkeypatch.setattr(agents, "save_context_projection", save_context_projection)
    runtime = OrderedRuntime()
    invocation = InvocationContext(
        job_id="job-1", workspace_id="workspace-1", brand_id="brand-1",
        user_id="operator-1", stage="understand", operation_id="job-1:understand:0",
    )
    with tenant_scope("workspace-1", "brand-1"):
        with operation_scope(
            "job:job-1:stage:understand", 4, goal_digest="a" * 64
        ):
            asyncio.run(_run_coordinator(
                "nimi_analyst",
                _analyst_input(),
                model="muse-spark-1.3",
                invocation=invocation,
                team_runtime=runtime,
                budget_reserver=lambda _record: None,
                budget_resolver=lambda _record: None,
                usage_reporter=lambda _record: None,
                activity_reporter=lambda _record: None,
            ))

    assert [item[0] for item in order] == ["artifact", "artifact", "projection", "runtime"]
    call = runtime.calls[0]
    projection = call["payload"]["_durable_context_projection"]
    assert projection["id"] == "projection-persisted"
    assert projection["manifestDigest"]
    assert projection["rendered"].startswith("# AUTHORITY — PINNED, NON-COMPACTABLE")
    assert call["session_key"].endswith(":" + projection["manifestDigest"])


def test_non_event_invocation_keeps_existing_managed_runtime_contract(monkeypatch) -> None:
    monkeypatch.setattr(
        agents,
        "create_artifact",
        lambda **_kwargs: (_ for _ in ()).throw(AssertionError("must not persist")),
        raising=False,
    )
    runtime = ManagedRuntime()
    with tenant_scope("workspace-1", "brand-1"):
        asyncio.run(_run_coordinator(
            "nimi_analyst", _analyst_input(), model="muse-test",
            team_runtime=runtime, activity_reporter=lambda _record: None,
        ))
    assert "_durable_context_projection" not in runtime.calls[0]["payload"]
