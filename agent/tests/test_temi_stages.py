"""Temi has a distinct planning stage before Noni production."""

from __future__ import annotations

import asyncio
from copy import deepcopy

import pytest

from harmonia_agent import stages
from harmonia_agent.agents import AgentProtocolError
from harmonia_agent.agent_models import ContentDraft, DraftWorkflowResult, EditorialPlan, EditorialReview
from harmonia_agent.operation_context import operation_scope
from tests.test_ryan_stages import job as ryan_job
from tests.test_ryan_strategy import strategy
from tests.test_temi_editorial_plan import plan
from tests.test_noni_contracts import editorial_checks


def approved_job() -> dict:
    source = ryan_job()
    source.update({
        "stage": "plan", "contentStrategy": strategy().model_dump(mode="json"),
        "strategyDigest": "a" * 64, "strategyRevision": 1,
        "strategyApprovalState": "approved",
        "strategyApproval": {"decision": "approved", "payloadDigest": "a" * 64, "revision": 1,
                             "actorSubjectId": "operator-1", "decidedAt": "2026-08-30T00:00:00Z",
                             "expiresAt": "2026-08-31T00:00:00Z"},
    })
    return source


def drafting_job() -> dict:
    source = approved_job()
    persisted_plan = plan()
    later = deepcopy(persisted_plan["items"][0])
    later.update({
        "id": "item-2", "publicationWindowStartAt": "2026-09-04T16:00:00Z",
        "publicationWindowEndAt": "2026-09-04T18:00:00Z",
        "productionDeadlineAt": "2026-09-04T12:00:00Z", "selectionScore": 0.5,
    })
    persisted_plan["items"].append(later)
    source.update({
        "stage": "draft",
        "editorialPlan": persisted_plan,
        "editorialPlanDigest": stages.editorial_plan_digest(persisted_plan),
        "selectedNextItemId": persisted_plan["selectedNextItemId"],
        "editorialItemStates": {
            item["id"]: {"status": "selected" if item["id"] == persisted_plan["selectedNextItemId"] else "planned",
                         "updatedAt": "2026-08-30T00:00:00Z"}
            for item in persisted_plan["items"]
        },
        "strategyHistory": {"v1": {
            "strategy": deepcopy(source["contentStrategy"]), "digest": source["strategyDigest"],
            "revision": 1,
        }},
    })
    return source


def accepted_package(request, text="we cut nine days to forty hours Request a demo") -> DraftWorkflowResult:
    draft = ContentDraft(
        id="draft-1", planId=request.planId, planDigest=request.planDigest,
        strategyDigest=request.strategyDigest, editorialItemId=request.editorialItemId,
        briefId=request.briefId, revision=1, platform="x", format="text_post",
        audienceId=request.brief.audienceId, objective=request.brief.objective,
        funnelStage=request.brief.funnelStage, ctaIntent=request.brief.ctaIntent,
        text=text, ctaTreatment="Request a demo",
        intendedConversion=request.brief.intendedConversion,
        evidenceRefs=[request.referencedMoments[0].id],
        claims=[{"text": "we cut nine days to forty hours", "evidenceRefs": [request.referencedMoments[0].id]}],
        assumptions=[], confidence="high", appliedConstraints=request.constraints,
        priorDraftId=None, addressedIssueIds=[],
    )
    review = EditorialReview(
        id="review-1", planId=draft.planId, planDigest=draft.planDigest,
        strategyDigest=draft.strategyDigest, editorialItemId=draft.editorialItemId,
        briefId=draft.briefId, draftId=draft.id, revision=1, verdict="accepted",
        reviewedAt="2026-08-30T01:00:00Z", checks=editorial_checks(), issues=[],
        resolvedIssueIds=[],
    )
    return DraftWorkflowResult(originalDraft=draft, reviews=[review], revisionDraft=None, acceptedDraft=draft)


def test_editorial_plan_digest_is_canonical_and_matches_typescript():
    assert stages.editorial_plan_digest({"b": 2, "a": 1}) == stages.editorial_plan_digest({"a": 1, "b": 2})
    assert stages.editorial_plan_digest({"a": 1, "b": 2}) == "ff458d69501fbb5e708688638e6cb1fc345db8a935540a1dfaa9f6666c2415b9"


def test_editorial_plan_digest_matches_typescript_json_number_semantics():
    boundary = {
        "planId": "p", "version": 1, "approvedStrategyDigest": "a" * 64,
        "planningSnapshotId": "planning-j-v1", "planningSnapshotDigest": "d" * 64,
        "horizonStartAt": "2026-08-31T00:00:00Z", "horizonEndAt": "2026-09-28T00:00:00Z", "timezone": "UTC",
        "summary": "s", "sequencingRationale": "s", "cadenceRationale": "c", "assumptions": [], "confidence": "high",
        "items": [{
            "id": "i", "briefId": "b", "campaignTheme": "t", "contentPillar": "p", "objective": "o", "audienceId": "a",
            "funnelStage": "awareness", "intendedConversion": "c", "ctaIntent": "c", "kpi": "k", "channel": "x", "format": "text",
            "evidenceRefs": ["m1"], "publicationWindowStartAt": "2026-09-01T00:00:00Z", "publicationWindowEndAt": "2026-09-01T01:00:00Z",
            "productionDeadlineAt": "2026-08-31T12:00:00Z", "priority": 1, "selectionScore": 0.0, "dependencies": [], "productionStatus": "planned",
            "constraints": [], "requiredAssets": [], "planningRationale": "r", "selectionRationale": "r", "confidence": "high",
        }], "selectedNextItemId": "i",
    }
    fractional = {**boundary, "items": [{**boundary["items"][0], "selectionScore": 0.5}]}
    assert stages.editorial_plan_digest(fractional) != stages.editorial_plan_digest(boundary)
    assert stages.editorial_plan_digest({"score": -0.0, "priority": 1.0}) == stages.editorial_plan_digest({"score": 0, "priority": 1})
    assert stages.editorial_plan_digest({"score": 0.000001}) == "5202ed6a6376c41e3da111657d47f780e6a251a7e8cfa384fd0d59054f36f545"
    assert stages.editorial_plan_digest({"score": 0.0000001}) == "27539988ad05838b3afeeae74e238d5130e3560aaf93a71be1d2fb494bee95fd"
    assert stages.editorial_plan_digest({"score": 0.5}) == "e4ddae75dae7f08e3fe435a9366ad4b206916d510e4de005c1481c71816b938c"


def test_plan_runs_temi_and_persists_complete_plan_before_any_draft(monkeypatch):
    calls, posts = [], []

    async def fake_plan(request, *, invocation):
        calls.append((request, invocation))
        return EditorialPlan.model_validate(plan())

    monkeypatch.setattr(stages, "get_job", lambda _id: approved_job())
    monkeypatch.setattr(stages, "get_editorial_planning_snapshot", lambda _id, **_kwargs: {
        "snapshot": {
            "snapshotId": "planning-job-1-v1", "asOf": "2026-08-30T00:00:00Z",
            "horizonStartAt": "2026-08-31T00:00:00Z", "horizonEndAt": "2026-09-28T00:00:00Z",
            "timezone": "UTC", "channelCapabilities": [{"channel": "x", "formats": ["text_post"]}],
            "existingCommitments": [], "productionCapacity": {"maxItems": 8, "maxItemsPerWeek": 2},
            "cadenceConstraints": {"minimumHoursBetweenItems": 24, "maxItemsPerChannelPerWeek": 2},
            "postingWindowObservations": [], "assetReadiness": [], "blockedDependencies": [],
            "calendarProjection": [], "provenanceIds": ["policy:editorial-planning-v1"],
        },
        "digest": "d" * 64,
    })
    monkeypatch.setattr(stages, "plan_with_team", fake_plan)
    monkeypatch.setattr(stages, "draft_with_team", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("Noni ran before plan persistence")))
    monkeypatch.setattr(stages, "web_post", lambda path, payload: posts.append((path, payload)))

    with operation_scope("job:job-1:stage:plan:generation:12", 1):
        asyncio.run(stages.run_plan("job-1"))

    request, invocation = calls[0]
    assert request.strategyDigest == "a" * 64
    assert request.strategyApproval.payloadDigest == request.strategyDigest
    assert request.planningSnapshot.snapshotId == "planning-job-1-v1"
    assert request.planningSnapshotDigest == "d" * 64
    assert invocation.stage == "plan"
    assert invocation.operation_id == "job:job-1:stage:plan:generation:12"
    assert posts == [("/api/internal/editorial-plan", {
        "jobId": "job-1", "stage": "plan", "revision": 1,
        "plan": plan(), "modelUsed": stages.content.model_used(),
    })]


def test_planning_failure_prevents_persistence_and_draft_dispatch(monkeypatch):
    posts = []

    async def fail_plan(*_args, **_kwargs):
        raise RuntimeError("planning failed")

    monkeypatch.setattr(stages, "get_job", lambda _id: approved_job())
    monkeypatch.setattr(stages, "get_editorial_planning_snapshot", lambda _id: {
        "snapshot": {
            "snapshotId": "planning-job-1-v1", "asOf": "2026-08-30T00:00:00Z",
            "horizonStartAt": "2026-08-31T00:00:00Z", "horizonEndAt": "2026-09-28T00:00:00Z",
            "timezone": "UTC", "channelCapabilities": [{"channel": "x", "formats": ["text_post"]}],
            "existingCommitments": [], "productionCapacity": {"maxItems": 8, "maxItemsPerWeek": 2},
            "cadenceConstraints": {"minimumHoursBetweenItems": 24, "maxItemsPerChannelPerWeek": 2},
            "postingWindowObservations": [], "assetReadiness": [], "blockedDependencies": [],
            "calendarProjection": [], "provenanceIds": ["policy:editorial-planning-v1"],
        }, "digest": "d" * 64,
    })
    monkeypatch.setattr(stages, "plan_with_team", fail_plan)
    monkeypatch.setattr(stages, "web_post", lambda path, payload: posts.append((path, payload)))

    with pytest.raises(RuntimeError, match="planning failed"):
        asyncio.run(stages.run_plan("job-1"))
    assert posts == []


@pytest.mark.parametrize("mutation", [
    lambda job: job.update(selectedNextItemId="missing"),
    lambda job: job.update(editorialPlanDigest="b" * 64),
    lambda job: job["editorialItemStates"][job["selectedNextItemId"]].update(status="planned"),
    lambda job: job["editorialPlan"]["items"][0].update(briefId="missing"),
])
def test_invalid_persisted_production_authority_never_invokes_noni(monkeypatch, mutation):
    source = drafting_job()
    mutation(source)
    invoked = []
    monkeypatch.setattr(stages, "get_job", lambda _id: source)
    monkeypatch.setattr(stages, "draft_with_team", lambda *_a, **_k: invoked.append(True))
    monkeypatch.setattr(stages, "web_post", lambda *_a, **_k: {"outcome": "execute"})

    with pytest.raises(AgentProtocolError):
        asyncio.run(stages.run_draft("job-1"))
    assert invoked == []


def test_draft_rejects_plan_not_bound_to_job_strategy_digest(monkeypatch):
    source = drafting_job()
    source["editorialPlan"]["approvedStrategyDigest"] = "b" * 64
    source["editorialPlanDigest"] = stages.editorial_plan_digest(source["editorialPlan"])
    invoked = []
    monkeypatch.setattr(stages, "get_job", lambda _id: source)
    monkeypatch.setattr(stages, "draft_with_team", lambda *_a, **_k: invoked.append(True))
    with pytest.raises(AgentProtocolError, match="approved strategy digest"):
        asyncio.run(stages.run_draft("job-1"))
    assert invoked == []
