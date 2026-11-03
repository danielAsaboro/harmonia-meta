import pytest
from pydantic import ValidationError

from harmonia_agent.a2ui_models import SurfacePlan, UiContext


def context_payload() -> dict:
    return {
        "runId": "run-1",
        "operatorRequest": "Compare the launch drafts.",
        "intent": "list_artifacts",
        "job": {
            "id": "job-1",
            "stage": "awaiting_approval",
            "status": "waiting_for_approval",
            "title": "Outcome launch",
            "sourceKind": "video",
        },
        "drafts": [
            {
                "id": "draft-1",
                "platform": "x",
                "valid": True,
                "momentId": "moment-1",
            }
        ],
        "moments": [{"id": "moment-1", "title": "Outcome proof", "startSec": 12, "endSec": 24}],
        "sources": [{"id": "source-video", "kind": "video", "label": "Source video"}],
        "assets": [],
        "actions": [{"id": "action-1", "type": "publish_x_post", "pending": True}],
        "receipts": [],
    }


def test_ui_context_accepts_bounded_reference_summaries() -> None:
    context = UiContext.model_validate(context_payload())

    assert context.job is not None
    assert context.job.id == "job-1"
    assert context.drafts[0].id == "draft-1"


def test_ui_context_requires_a_durable_run_id() -> None:
    payload = context_payload()
    del payload["runId"]

    with pytest.raises(ValidationError):
        UiContext.model_validate(payload)


def test_surface_plan_accepts_only_known_components_and_references() -> None:
    plan = SurfacePlan.model_validate(
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
                            "component": "DraftComparison",
                            "refs": {"jobId": "job-1", "draftIds": ["draft-1"]},
                            "children": [],
                        }
                    ],
                }
            ],
        }
    )

    assert plan.surfaces[0].nodes[0].refs.draftIds == ["draft-1"]


def test_surface_plan_accepts_bounded_art_direction() -> None:
    plan = SurfacePlan.model_validate(
        {
            "version": "harmonia.ui/v1",
            "surfaces": [
                {
                    "slot": "canvas",
                    "revision": 1,
                    "rootId": "brief",
                    "artDirection": {
                        "rhythm": "editorial",
                        "composition": "mosaic",
                        "energy": "active",
                    },
                    "nodes": [
                        {
                            "id": "brief",
                            "component": "CampaignBrief",
                            "refs": {"jobId": "job-1"},
                            "artDirection": {
                                "tone": "ink",
                                "role": "hero",
                                "density": "airy",
                                "motion": "reveal",
                            },
                            "children": [],
                        }
                    ],
                }
            ],
        }
    )

    assert plan.surfaces[0].artDirection.composition == "mosaic"
    assert plan.surfaces[0].nodes[0].artDirection.tone == "ink"


def test_surface_plan_rejects_arbitrary_style() -> None:
    with pytest.raises(ValidationError):
        SurfacePlan.model_validate(
            {
                "version": "harmonia.ui/v1",
                "surfaces": [
                    {
                        "slot": "canvas",
                        "revision": 1,
                        "rootId": "brief",
                        "nodes": [
                            {
                                "id": "brief",
                                "component": "CampaignBrief",
                                "refs": {},
                                "style": "color:red",
                                "children": [],
                            }
                        ],
                    }
                ],
            }
        )


def test_surface_plan_rejects_authoritative_inline_content() -> None:
    with pytest.raises(ValidationError):
        SurfacePlan.model_validate(
            {
                "version": "harmonia.ui/v1",
                "surfaces": [
                    {
                        "slot": "approval",
                        "revision": 1,
                        "rootId": "root",
                        "nodes": [
                            {
                                "id": "root",
                                "component": "ApprovalReview",
                                "refs": {"jobId": "job-1", "actionIds": ["action-1"]},
                                "children": [],
                                "risk": "low",
                            }
                        ],
                    }
                ],
            }
        )


@pytest.mark.parametrize("component", ["SurfaceLoading", "SurfaceEmpty", "SurfaceUnresolved", "SurfaceFailure"])
def test_surface_plan_rejects_host_owned_lifecycle_components(component: str) -> None:
    with pytest.raises(ValidationError):
        SurfacePlan.model_validate({
            "version": "harmonia.ui/v1",
            "surfaces": [{"slot": "canvas", "revision": 1, "rootId": "root", "nodes": [
                {"id": "root", "component": component, "children": []},
            ]}],
        })


def test_ui_context_rejects_duplicate_durable_ids() -> None:
    payload = context_payload()
    payload["drafts"].append(dict(payload["drafts"][0]))
    with pytest.raises(ValidationError, match="draft ids must be unique"):
        UiContext.model_validate(payload)


def test_surface_plan_rejects_dangling_children() -> None:
    with pytest.raises(ValidationError, match="dangling child"):
        SurfacePlan.model_validate(
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
                                "component": "CampaignBrief",
                                "refs": {"jobId": "job-1"},
                                "children": ["missing"],
                            }
                        ],
                    }
                ],
            }
        )


@pytest.mark.parametrize(
    "nodes, message",
    [
        (
            [
                {"id": "root", "component": "CampaignBrief", "refs": {"jobId": "job-1"}, "children": ["child"]},
                {"id": "child", "component": "JobProgress", "refs": {"jobId": "job-1"}, "children": ["root"]},
            ],
            "cycle",
        ),
        (
            [
                {"id": "root", "component": "CampaignBrief", "refs": {"jobId": "job-1"}, "children": []},
                {"id": "orphan", "component": "JobProgress", "refs": {"jobId": "job-1"}, "children": []},
            ],
            "unreachable",
        ),
    ],
)
def test_surface_plan_rejects_unsafe_graph_shapes(nodes: list[dict], message: str) -> None:
    with pytest.raises(ValidationError, match=message):
        SurfacePlan.model_validate(
            {
                "version": "harmonia.ui/v1",
                "surfaces": [{"slot": "canvas", "revision": 1, "rootId": "root", "nodes": nodes}],
            }
        )
