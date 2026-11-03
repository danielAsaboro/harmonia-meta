from __future__ import annotations

import base64
import json

from fastapi.testclient import TestClient

from harmonia_agent import main
from harmonia_agent.operation_context import current_operation
from harmonia_agent.tenant_context import current_tenant


def envelope() -> dict:
    data = {
        "schemaVersion": 1,
        "source": "stage_outbox",
        "sourceEventId": "stage-outbox:outbox-1",
        "workspaceId": "workspace-1",
        "brandId": "brand-1",
        "jobId": "job-1",
        "eventType": "stage.requested",
        "operationId": "job:job-1:stage:draft:generation:0",
        "correlationId": "job:job-1",
        "attempt": 0,
        "trust": "system",
        "occurredAt": "2026-08-28T12:00:00.000Z",
        "payload": {"stage": "draft"},
        "payloadDigest": "a" * 64,
    }
    return {
        "message": {
            "messageId": "delivery-1",
            "data": base64.b64encode(json.dumps(data).encode()).decode(),
            "attributes": {
                "workspaceId": "workspace-1",
                "brandId": "brand-1",
                "sourceEventId": "stage-outbox:outbox-1",
                "operationId": "job:job-1:stage:draft:generation:0",
            },
        }
    }


def test_push_deduplicates_before_stage_dispatch(monkeypatch) -> None:
    entered = []
    monkeypatch.setattr(main, "claim_event_inbox", lambda _payload: {"outcome": "in_progress"})
    monkeypatch.setattr(main, "dispatch", lambda *_args, **_kwargs: entered.append(True))

    response = TestClient(main.app).post("/pubsub/push", json=envelope())

    assert response.status_code == 200
    assert response.json()["duplicate"] is True
    assert entered == []


def test_push_scopes_fenced_stage_calls_and_finalizes(monkeypatch) -> None:
    finalized = []
    seen = []
    monkeypatch.setattr(main, "claim_event_inbox", lambda _payload: {"outcome": "execute"})
    monkeypatch.setattr(main, "claim_operation", lambda _payload: {
        "outcome": "execute", "operation": {"epoch": 4},
    })
    monkeypatch.setattr(main, "complete_event_inbox", finalized.append)

    async def dispatch(_job_id, _stage, *, attempt=0, operation_id=None):
        seen.append((current_operation().operation_id, current_operation().epoch, attempt))
        return True

    monkeypatch.setattr(main, "dispatch", dispatch)
    redelivery = envelope()
    redelivery["deliveryAttempt"] = 4
    response = TestClient(main.app).post("/pubsub/push", json=redelivery)

    assert response.status_code == 200
    assert seen == [("job:job-1:stage:draft:generation:0", 4, 0)]
    assert finalized[0]["operationEpoch"] == 4
    assert finalized[0]["operationState"] == "succeeded"
    assert current_operation() is None


def test_push_finalizes_failed_stage_as_failed_operation(monkeypatch) -> None:
    finalized = []
    monkeypatch.setattr(main, "claim_event_inbox", lambda _payload: {"outcome": "execute"})
    monkeypatch.setattr(main, "claim_operation", lambda _payload: {"outcome": "execute", "operation": {"epoch": 5}})
    monkeypatch.setattr(main, "complete_event_inbox", finalized.append)

    async def failed(_job_id, _stage, *, attempt=0, operation_id=None):
        assert operation_id == "job:job-1:stage:draft:generation:0"
        return "failed"

    monkeypatch.setattr(main, "dispatch", failed)
    response = TestClient(main.app).post("/pubsub/push", json=envelope())

    assert response.status_code == 200
    assert response.json()["failed"] is True
    assert finalized[0]["outcome"] == "rejected"
    assert finalized[0]["operationState"] == "failed"


def test_push_leaves_claims_for_recovery_on_transient_crash(monkeypatch) -> None:
    monkeypatch.setattr(main, "claim_event_inbox", lambda _payload: {"outcome": "execute"})
    monkeypatch.setattr(main, "claim_operation", lambda _payload: {
        "outcome": "execute", "operation": {"epoch": 1},
    })
    monkeypatch.setattr(main, "complete_event_inbox", lambda _payload: (_ for _ in ()).throw(AssertionError("must not finalize")))

    async def crash(*_args, **_kwargs):
        raise RuntimeError("worker crashed")

    monkeypatch.setattr(main, "dispatch", crash)
    response = TestClient(main.app, raise_server_exceptions=False).post("/pubsub/push", json=envelope())
    assert response.status_code == 503
    assert response.json()["retryable"] is True


def test_health_reports_durable_runtime_capabilities_without_secrets() -> None:
    response = TestClient(main.app).get("/healthz")
    assert response.status_code == 200
    payload = response.json()
    assert payload["durableRuntime"] == {
        "protocolVersion": 1,
        "stateStore": "firestore",
        "wakeTransport": "pubsub",
        "contextCompiler": "harmonia-context/v1",
        "recovery": {"limit": 20, "deadlineSeconds": 15, "maxRetries": 3},
    }
    assert "internalApiToken" not in payload


def test_local_pubsub_project_can_be_separated_from_vertex_project(monkeypatch) -> None:
    monkeypatch.setenv("PUBSUB_EMULATOR_PROJECT", "harmonia-local")
    assert main._pubsub_project() == "harmonia-local"


def test_recovery_wake_uses_bounded_config(monkeypatch) -> None:
    calls = []
    monkeypatch.setattr("harmonia_agent.web_client.get_workspaces", lambda: [
        {"workspaceId": "workspace-1", "brandId": "brand-1"},
        {"workspaceId": "workspace-2", "brandId": "brand-2"},
    ])

    def recover(**kwargs):
        tenant = current_tenant()
        calls.append({"workspaceId": tenant.workspace_id, "brandId": tenant.brand_id, **kwargs})
        return [{"id": f"recovery:{tenant.workspace_id}"}]

    monkeypatch.setattr("harmonia_agent.recovery.recover_missed", recover)
    response = TestClient(main.app).post("/durable/recover")
    assert response.status_code == 200
    assert response.json()["actionCount"] == 2
    assert response.json()["workspaces"] == [
        {"workspaceId": "workspace-1", "actionCount": 1, "actions": [{"id": "recovery:workspace-1"}]},
        {"workspaceId": "workspace-2", "actionCount": 1, "actions": [{"id": "recovery:workspace-2"}]},
    ]
    expected = {
        "limit": 20,
        "deadline_seconds": 15,
        "max_retries": 3,
        "max_cost_usd": "0.250000",
    }
    assert calls == [
        {"workspaceId": "workspace-1", "brandId": "brand-1", **expected},
        {"workspaceId": "workspace-2", "brandId": "brand-2", **expected},
    ]
