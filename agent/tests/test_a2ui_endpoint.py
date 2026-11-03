from __future__ import annotations

from fastapi import FastAPI
from fastapi.testclient import TestClient

from harmonia_agent import a2ui_api
from harmonia_agent.a2ui_api import router
from harmonia_agent.a2ui_models import SurfacePlan


def context_payload() -> dict:
    return {
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
        "moments": [{"id": "moment-1", "title": "Outcome proof", "startSec": 12, "endSec": 24}],
        "sources": [{"id": "source-video", "kind": "video", "label": "Source video"}],
        "assets": [],
        "actions": [],
        "receipts": [],
    }


def plan_fixture() -> SurfacePlan:
    return SurfacePlan.model_validate(
        {
            "version": "harmonia.ui/v1",
            "surfaces": [
                {
                    "slot": "canvas",
                    "revision": 1,
                    "rootId": "root",
                    "nodes": [
                        {
                            "id": "root",
                            "component": "MomentExplorer",
                            "refs": {"jobId": "job-1", "momentIds": ["moment-1"]},
                            "children": [],
                        }
                    ],
                }
            ],
        }
    )


def client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def headers() -> dict[str, str]:
    return {
        "x-harmonia-internal-token": "test-token-not-a-secret",
        "x-workspace-id": "workspace-1",
        "x-brand-id": "brand-1",
        "x-user-id": "operator-1",
    }


def test_a2ui_plan_rejects_missing_internal_token() -> None:
    response = client().post("/internal/a2ui/plan", json=context_payload())

    assert response.status_code == 401


def test_a2ui_plan_scopes_managed_invocation_to_headers(monkeypatch) -> None:
    captured = {}

    async def fake_plan_surface(context, *, invocation):
        captured["context"] = context
        captured["invocation"] = invocation
        return plan_fixture()

    monkeypatch.setattr(a2ui_api, "plan_surface", fake_plan_surface)

    response = client().post("/internal/a2ui/plan", json=context_payload(), headers=headers())

    assert response.status_code == 200
    assert response.json()["surfaces"][0]["nodes"][0]["component"] == "MomentExplorer"
    assert captured["invocation"].workspace_id == "workspace-1"
    assert captured["invocation"].brand_id == "brand-1"
    assert captured["invocation"].user_id == "operator-1"
    assert captured["invocation"].operation_id == "job-1:presentation:run-1"


def test_a2ui_plan_requires_a_job_backed_context() -> None:
    payload = context_payload()
    payload["job"] = None

    response = client().post("/internal/a2ui/plan", json=payload, headers=headers())

    assert response.status_code == 422

