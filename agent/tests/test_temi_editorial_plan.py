"""Strict boundary contracts for Temi planning and Noni production handoff."""

from __future__ import annotations

from copy import deepcopy

import pytest
from pydantic import ValidationError

from harmonia_agent.agent_models import (
    CopywriterInput,
    EditorialPlan,
    EditorialPlannerInput,
)
from harmonia_agent.agents import AgentProtocolError, validate_editorial_plan


def strategy() -> dict:
    return {
        "strategyId": "strategy-job-1-v1", "version": 1, "horizonWeeks": 4,
        "thesis": "Lead with verified operating proof.",
        "differentiatedNarrative": "Harmonia connects evidence to governed execution.",
        "objectives": [{"text": "Increase qualified demos", "evidenceRefs": ["ctx-campaign"]}],
        "audiencePriorities": [{"audienceId": "aud-founders", "priority": 1, "reason": "Founders own the bottleneck", "evidenceRefs": ["ctx-campaign"]}],
        "funnelIntent": "consideration", "intendedConversions": ["request a product demo"],
        "pillars": [{"name": "operational proof", "purpose": "Demonstrate measurable gains", "evidenceRefs": ["m1", "perf-1"]}],
        "campaignThemes": [{"name": "From delay to flow", "message": "Governance can accelerate delivery", "evidenceRefs": ["m1"]}],
        "channelRoles": [{"channel": "x", "role": "proof-led discovery", "operationallySupported": True, "formats": ["text_post"], "cadence": "2 posts per week", "evidenceRefs": ["ctx-campaign"]}],
        "contentMix": [{"format": "text_post", "percentage": 100}],
        "cadenceGuidance": "Two supported-channel items per week.",
        "priorityRules": ["Prefer quantified source proof"],
        "ctaGuidance": ["Invite qualified operators to request a demo"],
        "kpis": [{"name": "qualified demo requests", "target": "measure weekly", "measurement": "verified attributed requests", "evidenceRefs": ["ctx-campaign"]}],
        "successCriteria": ["At least one verified qualified demo request"],
        "constraints": ["Use only supplied evidence"], "exclusions": ["Unsupported outcome claims"],
        "brandSafety": ["Never imply autonomous approval"],
        "briefs": [{
            "id": "brief-1", "title": "Nine days to forty hours", "objective": "Show operational proof",
            "audienceId": "aud-founders", "funnelStage": "consideration", "keyMessage": "Governed workflows reduce activation delay",
            "channelCandidates": ["x"], "formatCandidates": ["text_post"],
            "ctaIntent": "request a demo", "intendedConversion": "qualified demo request", "kpi": "qualified demo requests",
            "priority": 1, "dependencies": [], "constraints": ["Quote the source exactly"],
            "evidenceRefs": ["m1", "ctx-campaign"],
        }],
        "assumptions": [], "confidence": "high",
    }


def analysis() -> dict:
    return {
        "sourceDigest": "c" * 64,
        "summary": "Activation time fell from nine days to forty hours.",
        "moments": [{"id": "m1", "title": "Activation", "startSec": 2, "endSec": 8, "hook": "Nine days to forty hours", "quote": "we cut nine days to forty hours", "sourceSegmentRefs": ["segment-1"], "visualEvidenceIds": [], "assumptions": [], "confidence": "high"}],
        "angles": [{"id": "a1", "angleType": "source_insight", "evidenceKind": "source", "title": "Operational speed", "rationale": "The source demonstrates measurable improvement.", "evidenceRefs": ["m1"], "assumptions": [], "confidence": "high"}],
        "assumptions": [], "confidence": "high",
    }


def plan() -> dict:
    return {
        "planId": "plan-job-1-v1", "version": 1, "approvedStrategyDigest": "a" * 64,
        "planningSnapshotId": "planning-job-1-v1", "planningSnapshotDigest": "d" * 64,
        "horizonStartAt": "2026-08-31T00:00:00Z", "horizonEndAt": "2026-09-28T00:00:00Z",
        "timezone": "America/Los_Angeles", "summary": "A four-week proof-led campaign.",
        "sequencingRationale": "Start with the strongest source proof.",
        "cadenceRationale": "One focused item begins the approved horizon.",
        "assumptions": ["The verified audience remains available during the horizon."], "confidence": "high",
        "selectedNextItemId": "item-1",
        "items": [{
            "id": "item-1", "briefId": "brief-1", "campaignTheme": "From delay to flow", "contentPillar": "operational proof",
            "objective": "Show operational proof", "audienceId": "aud-founders", "funnelStage": "consideration",
            "intendedConversion": "qualified demo request", "ctaIntent": "request a demo", "kpi": "qualified demo requests",
            "channel": "x", "format": "text_post", "evidenceRefs": ["m1", "ctx-campaign"],
            "publicationWindowStartAt": "2026-09-01T16:00:00Z", "publicationWindowEndAt": "2026-09-01T18:00:00Z",
            "productionDeadlineAt": "2026-08-31T18:00:00Z", "priority": 1, "selectionScore": 0.9,
            "dependencies": [], "productionStatus": "planned", "constraints": ["Quote the source exactly"],
            "requiredAssets": ["source-clip"], "planningRationale": "The first proof post opens the campaign.",
            "selectionRationale": "This is the highest-priority unblocked brief.", "confidence": "high",
        }],
    }


def planner_input() -> dict:
    return {
        "strategy": strategy(), "strategyDigest": "a" * 64, "strategyVersion": 1,
        "strategyApproval": {"decision": "approved", "payloadDigest": "a" * 64, "revision": 1, "actorSubjectId": "operator-1", "decidedAt": "2026-08-30T00:00:00Z", "expiresAt": "2026-08-31T00:00:00Z"},
        "analysis": analysis(),
        "planningSnapshot": {
            "snapshotId": "planning-job-1-v1", "asOf": "2026-08-30T00:00:00Z",
            "horizonStartAt": "2026-08-31T00:00:00Z", "horizonEndAt": "2026-09-28T00:00:00Z", "timezone": "America/Los_Angeles",
            "channelCapabilities": [{"channel": "x", "formats": ["text_post"]}],
            "existingCommitments": [{"id": "commitment-1", "channel": "x", "publicationWindowStartAt": "2026-09-03T16:00:00Z", "publicationWindowEndAt": "2026-09-03T18:00:00Z"}],
            "productionCapacity": {"maxItems": 8, "maxItemsPerWeek": 2},
            "cadenceConstraints": {"minimumHoursBetweenItems": 24, "maxItemsPerChannelPerWeek": 2},
            "postingWindowObservations": [{"id": "window-1", "channel": "x", "format": "text_post", "observedAt": "2026-08-29T00:00:00Z", "evidenceRefs": ["perf-1"]}],
            "assetReadiness": [], "blockedDependencies": [], "calendarProjection": [],
            "provenanceIds": ["policy:editorial-planning-v1"],
        },
        "planningSnapshotDigest": "d" * 64,
        "revision": 1,
    }


def test_plan_is_bound_to_the_exact_deterministic_planning_snapshot():
    supplied = planner_input()
    candidate = plan()
    assert validate(candidate, supplied).planningSnapshotId == "planning-job-1-v1"

    candidate["planningSnapshotDigest"] = "e" * 64
    with pytest.raises(AgentProtocolError, match="planning snapshot digest"):
        validate(candidate, supplied)


def production_input() -> dict:
    return {
        "planId": "plan-job-1-v1", "planDigest": "b" * 64,
        "strategyDigest": "a" * 64, "editorialItemId": "item-1", "briefId": "brief-1",
        "editorialItem": plan()["items"][0],
        "brief": strategy()["briefs"][0], "referencedMoments": analysis()["moments"],
        "referencedAngles": [], "brandContext": "Use a direct, evidence-led voice.",
        "constraints": ["Quote the source exactly", "Never imply autonomous approval"],
        "platform": "x", "format": "text_post", "passType": "original",
        "priorDraft": None, "priorReview": None,
    }


def test_complete_strict_temi_contracts_are_accepted():
    assert EditorialPlannerInput.model_validate(planner_input()).timezone == "America/Los_Angeles"
    assert EditorialPlan.model_validate(plan()).selectedNextItemId == "item-1"
    assert CopywriterInput.model_validate(production_input()).editorialItem.id == "item-1"


def test_production_input_rejects_mismatched_brief_and_unreferenced_evidence():
    invalid = production_input()
    invalid["brief"]["id"] = "brief-other"
    with pytest.raises(ValidationError, match="exact selected brief"):
        CopywriterInput.model_validate(invalid)

    invalid = production_input()
    invalid["referencedMoments"].append({
        "id": "m-extra", "title": "Invented", "startSec": 0, "endSec": 1,
        "hook": "h", "quote": "q", "sourceSegmentRefs": ["segment-1"],
        "visualEvidenceIds": [], "assumptions": [], "confidence": "high",
    })
    with pytest.raises(ValidationError, match="referenced Nimi evidence"):
        CopywriterInput.model_validate(invalid)


@pytest.mark.parametrize(("model", "payload", "field"), [
    (EditorialPlannerInput, planner_input, "strategyApproval"),
    (EditorialPlan, plan, "sequencingRationale"),
    (CopywriterInput, production_input, "brief"),
])
def test_temi_contracts_require_every_boundary_field(model, payload, field):
    invalid = deepcopy(payload())
    del invalid[field]
    with pytest.raises(ValidationError):
        model.model_validate(invalid)


def test_plan_requires_exactly_one_selected_item_and_planned_production_state():
    invalid = plan()
    invalid["selectedNextItemId"] = "missing-item"
    with pytest.raises(ValidationError, match="selectedNextItemId"):
        EditorialPlan.model_validate(invalid)

    invalid = plan()
    invalid["items"][0]["productionStatus"] = "selected"
    with pytest.raises(ValidationError):
        EditorialPlan.model_validate(invalid)


@pytest.mark.parametrize(("payload", "field"), [
    (plan, "finalPostCopy"),
    (plan, "externalEventId"),
    (plan, "receipt"),
    (production_input, "publishPayload"),
])
def test_temi_contracts_reject_copy_and_external_effect_authority(payload, field):
    invalid = deepcopy(payload())
    invalid[field] = "forbidden"
    model = EditorialPlan if payload is plan else CopywriterInput
    with pytest.raises(ValidationError, match="extra_forbidden"):
        model.model_validate(invalid)


def test_temi_contracts_require_utc_horizon_boundaries_and_an_iana_timezone():
    invalid = planner_input()
    invalid["planningSnapshot"]["horizonStartAt"] = "2026-08-31T00:00:00+01:00"
    with pytest.raises(ValidationError, match="UTC"):
        EditorialPlannerInput.model_validate(invalid)

    invalid = plan()
    invalid["timezone"] = "not/a-timezone"
    with pytest.raises(ValidationError, match="IANA"):
        EditorialPlan.model_validate(invalid)


@pytest.mark.parametrize(("factory", "path", "value"), [
    (planner_input, ("planningSnapshot", "channelCapabilities", 0, "formats", 0), ""),
    (planner_input, ("planningSnapshot", "channelCapabilities", 0, "formats", 0), "x" * 101),
    (planner_input, ("planningSnapshot", "postingWindowObservations", 0, "evidenceRefs", 0), ""),
    (planner_input, ("planningSnapshot", "postingWindowObservations", 0, "evidenceRefs", 0), "x" * 101),
    (plan, ("items", 0, "evidenceRefs", 0), ""),
    (plan, ("items", 0, "evidenceRefs", 0), "x" * 101),
    (plan, ("items", 0, "dependencies"), ["x" * 101]),
    (plan, ("items", 0, "constraints", 0), ""),
    (plan, ("items", 0, "constraints", 0), "x" * 301),
    (plan, ("items", 0, "requiredAssets", 0), ""),
    (plan, ("items", 0, "requiredAssets", 0), "x" * 301),
    (plan, ("assumptions", 0), ""),
    (plan, ("assumptions", 0), "x" * 501),
    (production_input, ("constraints", 0), ""),
    (production_input, ("constraints", 0), "x" * 301),
])
def test_python_rejects_the_same_new_list_item_boundaries_as_zod(factory, path, value):
    invalid = factory()
    target = invalid
    for segment in path[:-1]:
        target = target[segment]
    target[path[-1]] = value
    model = EditorialPlannerInput if factory is planner_input else EditorialPlan if factory is plan else CopywriterInput
    with pytest.raises(ValidationError):
        model.model_validate(invalid)


def test_temporal_ordering_compares_equal_utc_instants_not_timestamp_spelling():
    invalid_input = planner_input()
    invalid_input["planningSnapshot"]["horizonStartAt"] = "2026-08-31T00:00:00+00:00"
    invalid_input["planningSnapshot"]["horizonEndAt"] = "2026-08-31T00:00:00Z"
    with pytest.raises(ValidationError, match="horizon"):
        EditorialPlannerInput.model_validate(invalid_input)

    invalid_plan = plan()
    invalid_plan["items"][0]["publicationWindowStartAt"] = "2026-09-01T16:00:00+00:00"
    invalid_plan["items"][0]["publicationWindowEndAt"] = "2026-09-01T16:00:00Z"
    with pytest.raises(ValidationError, match="publication window"):
        EditorialPlan.model_validate(invalid_plan)

    equal_deadline = plan()
    equal_deadline["items"][0]["publicationWindowStartAt"] = "2026-09-01T16:00:00+00:00"
    equal_deadline["items"][0]["productionDeadlineAt"] = "2026-09-01T16:00:00Z"
    assert EditorialPlan.model_validate(equal_deadline).items[0].productionDeadlineAt == EditorialPlan.model_validate(equal_deadline).items[0].publicationWindowStartAt


def validate(candidate: dict | None = None, supplied: dict | None = None) -> EditorialPlan:
    return validate_editorial_plan(
        EditorialPlannerInput.model_validate(supplied or planner_input()),
        EditorialPlan.model_validate(candidate or plan()),
    )


def test_complete_grounded_editorial_plan_is_validated():
    assert validate().planId == "plan-job-1-v1"


@pytest.mark.parametrize(("mutation", "message"), [
    (lambda value: value["items"][0].update(briefId="brief-invented"), "unknown brief"),
    (lambda value: value["items"][0].update(evidenceRefs=["a1"]), "outside brief"),
    (lambda value: value["items"][0].update(campaignTheme="Invented theme"), "campaign theme"),
    (lambda value: value["items"][0].update(contentPillar="Invented pillar"), "content pillar"),
    (lambda value: value["items"][0].update(audienceId="aud-invented"), "does not match brief"),
])
def test_plan_rejects_unknown_strategy_and_evidence_references(mutation, message):
    invalid = plan()
    mutation(invalid)
    with pytest.raises(AgentProtocolError, match=message):
        validate(invalid)


@pytest.mark.parametrize(("mutation", "message"), [
    (lambda value: value["items"][0].update(channel="linkedin"), "unsupported channel"),
    (lambda value: value["items"][0].update(format="video"), "unsupported format"),
    (lambda value: value["items"][0].update(objective="A different objective"), "does not match brief"),
    (lambda value: value["items"][0].update(kpi="vanity impressions"), "does not match brief"),
])
def test_plan_cannot_change_the_approved_brief_or_capabilities(mutation, message):
    invalid = plan()
    mutation(invalid)
    with pytest.raises(AgentProtocolError, match=message):
        validate(invalid)


@pytest.mark.parametrize(("field", "value", "message"), [
    ("publicationWindowStartAt", "2026-08-30T23:00:00Z", "outside editorial horizon"),
    ("publicationWindowEndAt", "2026-09-28T01:00:00Z", "outside editorial horizon"),
    ("productionDeadlineAt", "2026-08-30T23:00:00Z", "outside editorial horizon"),
])
def test_plan_rejects_item_timing_outside_the_approved_horizon(field, value, message):
    invalid = plan()
    invalid["items"][0][field] = value
    if field == "publicationWindowStartAt":
        invalid["items"][0]["productionDeadlineAt"] = "2026-08-30T22:00:00Z"
    with pytest.raises(AgentProtocolError, match=message):
        validate(invalid)


def test_plan_rejects_duplicate_or_committed_channel_slots():
    invalid = plan()
    duplicate = deepcopy(invalid["items"][0])
    duplicate["id"] = "item-2"
    invalid["items"].append(duplicate)
    with pytest.raises(AgentProtocolError, match="duplicate editorial slot"):
        validate(invalid)

    collision = plan()
    collision["items"][0]["publicationWindowStartAt"] = "2026-09-03T16:30:00Z"
    collision["items"][0]["publicationWindowEndAt"] = "2026-09-03T17:30:00Z"
    with pytest.raises(AgentProtocolError, match="existing commitment"):
        validate(collision)


def test_plan_rejects_unknown_and_cyclic_dependencies():
    invalid = plan()
    invalid["items"][0]["dependencies"] = ["missing-item"]
    with pytest.raises(AgentProtocolError, match="unknown dependencies"):
        validate(invalid)

    cyclic = plan()
    second = deepcopy(cyclic["items"][0])
    second.update(id="item-2", dependencies=["item-1"], publicationWindowStartAt="2026-09-04T16:00:00Z", publicationWindowEndAt="2026-09-04T18:00:00Z", productionDeadlineAt="2026-09-04T12:00:00Z")
    cyclic["items"][0]["dependencies"] = ["item-2"]
    cyclic["items"].append(second)
    with pytest.raises(AgentProtocolError, match="cyclic dependencies"):
        validate(cyclic)


def test_dependencies_must_finish_before_the_dependent_window_starts():
    reverse = plan()
    later = deepcopy(reverse["items"][0])
    later.update(
        id="item-2",
        publicationWindowStartAt="2026-09-04T16:00:00Z",
        publicationWindowEndAt="2026-09-04T18:00:00Z",
        productionDeadlineAt="2026-09-04T12:00:00Z",
    )
    reverse["items"][0]["dependencies"] = ["item-2"]
    reverse["items"].append(later)
    with pytest.raises(AgentProtocolError, match="must end at or before"):
        validate(reverse)

    equal_start = plan()
    simultaneous = deepcopy(equal_start["items"][0])
    simultaneous.update(id="item-2", channel="linkedin")
    equal_start["items"][0]["dependencies"] = ["item-2"]
    equal_start["items"].append(simultaneous)
    supplied = planner_input()
    supplied["strategy"]["briefs"][0]["channelCandidates"].append("linkedin")
    supplied["strategy"]["channelRoles"].append({
        "channel": "linkedin", "role": "proof-led consideration",
        "operationallySupported": True, "formats": ["text_post"],
        "cadence": "1 post per week", "evidenceRefs": ["ctx-campaign"],
    })
    supplied["planningSnapshot"]["channelCapabilities"].append({"channel": "linkedin", "formats": ["text_post"]})
    with pytest.raises(AgentProtocolError, match="must end at or before"):
        validate(equal_start, supplied)

    boundary = deepcopy(reverse)
    boundary["items"][0]["publicationWindowStartAt"] = "2026-09-04T18:00:00Z"
    boundary["items"][0]["publicationWindowEndAt"] = "2026-09-04T20:00:00Z"
    boundary["items"][0]["productionDeadlineAt"] = "2026-09-04T18:00:00Z"
    boundary["selectedNextItemId"] = "item-2"
    boundary["items"][1]["dependencies"] = []
    boundary_input = planner_input()
    boundary_input["planningSnapshot"]["cadenceConstraints"]["minimumHoursBetweenItems"] = 0
    assert validate(boundary, boundary_input).items[0].dependencies == ["item-2"]


def test_plan_rejects_capacity_and_cadence_overflow():
    invalid_input = planner_input()
    invalid_input["planningSnapshot"]["productionCapacity"]["maxItems"] = 1
    invalid = plan()
    second = deepcopy(invalid["items"][0])
    second.update(id="item-2", publicationWindowStartAt="2026-09-04T16:00:00Z", publicationWindowEndAt="2026-09-04T18:00:00Z", productionDeadlineAt="2026-09-04T12:00:00Z")
    invalid["items"].append(second)
    with pytest.raises(AgentProtocolError, match="production capacity"):
        validate(invalid, invalid_input)

    cadence_input = planner_input()
    cadence_input["planningSnapshot"]["productionCapacity"]["maxItemsPerWeek"] = 8
    cadence_plan = plan()
    for item_id, day in (("item-2", "04"), ("item-3", "06")):
        item = deepcopy(cadence_plan["items"][0])
        item.update(
            id=item_id,
            publicationWindowStartAt=f"2026-09-{day}T16:00:00Z",
            publicationWindowEndAt=f"2026-09-{day}T18:00:00Z",
            productionDeadlineAt=f"2026-09-{day}T12:00:00Z",
        )
        cadence_plan["items"].append(item)
    with pytest.raises(AgentProtocolError, match="per-channel weekly cadence"):
        validate(cadence_plan, cadence_input)


def test_selected_item_must_be_unblocked_and_highest_scoring_eligible_item():
    invalid = plan()
    second = deepcopy(invalid["items"][0])
    second.update(id="item-2", selectionScore=0.95, publicationWindowStartAt="2026-09-04T16:00:00Z", publicationWindowEndAt="2026-09-04T18:00:00Z", productionDeadlineAt="2026-09-04T12:00:00Z")
    invalid["items"].append(second)
    with pytest.raises(AgentProtocolError, match="highest-scoring eligible"):
        validate(invalid)

    blocked = deepcopy(invalid)
    blocked["selectedNextItemId"] = "item-2"
    blocked["items"][1]["dependencies"] = ["item-1"]
    with pytest.raises(AgentProtocolError, match="blocked"):
        validate(blocked)


@pytest.mark.parametrize(("input_mutation", "plan_mutation", "message"), [
    (lambda value: value.update(strategyDigest="b" * 64), lambda value: None, "strategy digest"),
    (lambda value: value["strategyApproval"].update(payloadDigest="b" * 64), lambda value: None, "approval digest"),
    (lambda value: value.update(strategyVersion=2), lambda value: None, "strategy version"),
    (lambda value: None, lambda value: value.update(approvedStrategyDigest="b" * 64), "approved strategy digest"),
])
def test_plan_requires_exact_approved_strategy_binding(input_mutation, plan_mutation, message):
    supplied = planner_input()
    candidate = plan()
    input_mutation(supplied)
    plan_mutation(candidate)
    with pytest.raises(AgentProtocolError, match=message):
        validate(candidate, supplied)


@pytest.mark.parametrize("end", [
    "2026-09-27T23:59:59Z",
    "2026-09-28T00:00:01Z",
])
def test_planning_horizon_duration_must_exactly_match_strategy_weeks(end):
    supplied = planner_input()
    supplied["planningSnapshot"]["horizonEndAt"] = end
    candidate = plan()
    candidate["horizonEndAt"] = end
    with pytest.raises(AgentProtocolError, match="horizon duration"):
        validate(candidate, supplied)


@pytest.mark.parametrize("claim", [
    "Temi approved this campaign for publication.",
    "Temi publishes this post to X now.",
    "The post was scheduled in Google Calendar.",
    "Publishing receipt receipt-123 was recorded.",
    "Use credential token abc to publish the final post copy.",
    "Execute this effect payload now.",
])
def test_plan_rejects_authority_overreach_in_free_text(claim):
    invalid = plan()
    invalid["summary"] = claim
    with pytest.raises(AgentProtocolError, match="authority overreach"):
        validate(invalid)


def test_authority_validation_allows_ordinary_planning_language_and_ryan_constraints():
    supplied = planner_input()
    supplied["strategy"]["briefs"][0]["constraints"].append(
        "Human approval is required before publishing."
    )
    candidate = plan()
    candidate["summary"] = "Publishing cadence balances proof and consideration across the horizon."
    candidate["sequencingRationale"] = "Plan publication windows around the campaign theme."
    candidate["items"][0]["constraints"].append(
        "Human approval is required before publishing."
    )
    assert validate(candidate, supplied).planId == "plan-job-1-v1"
