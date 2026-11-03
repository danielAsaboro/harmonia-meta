"""Closed-world validation for Dara's editorial judgment."""

from copy import deepcopy
from datetime import datetime, timezone

import pytest

from harmonia_agent.agent_models import EditorialAssessment
from harmonia_agent.agents import (
    AgentProtocolError,
    materialize_editorial_review,
    validate_editorial_assessment,
)
from tests.test_dara_contracts import passing_assessment
from tests.test_noni_contracts import grounded_draft, grounded_revision_draft, original_input, revision_input


def _validate(payload: dict | None = None):
    return validate_editorial_assessment(
        original_input(), grounded_draft(),
        EditorialAssessment.model_validate(payload or passing_assessment()),
    )


def test_accepts_complete_grounded_assessment_and_materializes_workflow_metadata():
    assessment = _validate()
    review = materialize_editorial_review(
        original_input(), grounded_draft(), assessment,
        reviewed_at=datetime(2026, 8, 27, 10, tzinfo=timezone.utc),
    )

    assert review.id == "review-cbfac029d8bb2956"
    assert review.draftId == "draft-1"
    assert review.reviewedAt.isoformat() == "2026-08-27T10:00:00+00:00"
    assert review.checks == assessment.checks


@pytest.mark.parametrize(("field", "value", "message"), [
    ("evidenceRefs", ["invented"], "unknown evidence"),
    ("constraintRefs", ["Invented constraint"], "unknown constraint"),
])
def test_rejects_invented_check_references(field, value, message):
    payload = passing_assessment()
    payload["checks"][0][field] = value
    with pytest.raises(AgentProtocolError, match=message):
        _validate(payload)


def test_requires_grounding_evidence_and_brand_safety_constraint_citations():
    for dimension, field, message in [
        ("grounding", "evidenceRefs", "grounding check must cite"),
        ("brand_voice", "constraintRefs", "brand voice check must cite"),
        ("safety", "constraintRefs", "safety check must cite"),
    ]:
        payload = passing_assessment()
        check = next(item for item in payload["checks"] if item["dimension"] == dimension)
        check[field] = []
        with pytest.raises(AgentProtocolError, match=message):
            _validate(payload)


@pytest.mark.parametrize(("category", "path"), [
    ("cta", "claims"), ("platform_constraints", "audienceId"),
    ("grounding", "format"), ("brand_voice", "platform"),
])
def test_rejects_issue_category_path_mismatch(category, path):
    payload = passing_assessment()
    payload["verdict"] = "revise"
    next(item for item in payload["checks"] if item["dimension"] == category)["status"] = "fail"
    payload["issues"] = [{
        "id": "issue-1", "category": category, "severity": "medium",
        "fieldPath": path, "instruction": "Correct the identified defect.",
        "evidenceRefs": [], "constraintRefs": [],
    }]
    with pytest.raises(AgentProtocolError, match="field path"):
        _validate(payload)


@pytest.mark.parametrize("instruction", [
    "Replace the post with: We cut nine days to forty hours.",
    "Option 1: Publish this now. Option 2: Schedule it tomorrow.",
    "Approved for publishing; receipt ID will be created.",
])
def test_rejects_replacement_copy_alternatives_and_authority(instruction):
    payload = passing_assessment()
    payload["verdict"] = "revise"
    next(item for item in payload["checks"] if item["dimension"] == "clarity")["status"] = "fail"
    payload["issues"] = [{
        "id": "issue-1", "category": "clarity", "severity": "medium",
        "fieldPath": "text", "instruction": instruction,
        "evidenceRefs": [], "constraintRefs": [],
    }]
    with pytest.raises(AgentProtocolError, match="replacement|alternative|authority"):
        _validate(payload)


@pytest.mark.parametrize(("category", "evidence_refs", "constraint_refs", "message"), [
    ("grounding", [], [], "grounding issue must cite"),
    ("brand_voice", [], [], "brand voice issue must cite"),
    ("safety", [], [], "safety issue must cite"),
])
def test_issues_require_dimension_specific_provenance(category, evidence_refs, constraint_refs, message):
    payload = passing_assessment()
    payload["verdict"] = "revise"
    next(item for item in payload["checks"] if item["dimension"] == category)["status"] = "fail"
    payload["issues"] = [{
        "id": "issue-1", "category": category, "severity": "medium",
        "fieldPath": "claims" if category in {"grounding", "safety"} else "text",
        "instruction": "Identify the unsupported claim and align it to the supplied source qualification.",
        "evidenceRefs": evidence_refs, "constraintRefs": constraint_refs,
    }]
    with pytest.raises(AgentProtocolError, match=message):
        _validate(payload)


@pytest.mark.parametrize("instruction", [
    "Make it clearer.", "Improve this.", "Fix the issue.", "Correct the identified defect.",
])
def test_rejects_vague_revision_instructions(instruction):
    payload = passing_assessment()
    payload["verdict"] = "revise"
    payload["checks"][-1]["status"] = "fail"
    payload["issues"] = [{
        "id": "issue-1", "category": "clarity", "severity": "medium",
        "fieldPath": "text", "instruction": instruction,
        "evidenceRefs": [], "constraintRefs": [],
    }]
    with pytest.raises(AgentProtocolError, match="actionable correction outcome"):
        _validate(payload)


def test_rejects_non_ascii_assessment_before_semantic_validation():
    payload = passing_assessment()
    payload["checks"][0]["rationale"] = "通过 grounding review."
    with pytest.raises(AgentProtocolError, match="ASCII-only"):
        _validate(payload)


def test_original_assessment_cannot_claim_resolved_issues():
    payload = passing_assessment()
    payload["resolvedIssueIds"] = ["issue-1"]
    with pytest.raises(AgentProtocolError, match="original.*resolve"):
        _validate(payload)


def test_accepted_revision_must_resolve_exactly_every_prior_issue():
    payload = passing_assessment()
    payload["resolvedIssueIds"] = ["issue-1"]
    assert validate_editorial_assessment(
        revision_input(), grounded_revision_draft(),
        EditorialAssessment.model_validate(payload),
    ).resolvedIssueIds == ["issue-1"]

    payload["resolvedIssueIds"] = []
    with pytest.raises(AgentProtocolError, match="accepted revision.*every prior issue"):
        validate_editorial_assessment(
            revision_input(), grounded_revision_draft(),
            EditorialAssessment.model_validate(payload),
        )


def test_revision_assessment_cannot_invent_resolved_issue_ids():
    payload = passing_assessment()
    payload["resolvedIssueIds"] = ["invented"]
    with pytest.raises(AgentProtocolError, match="unknown resolved issue"):
        validate_editorial_assessment(
            revision_input(), grounded_revision_draft(),
            EditorialAssessment.model_validate(payload),
        )
