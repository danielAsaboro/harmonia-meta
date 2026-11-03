"""Strict Dara assessment and persisted-review contracts."""

from copy import deepcopy

import pytest
from pydantic import ValidationError

from harmonia_agent.agent_models import EditorialAssessment


DIMENSIONS = [
    "grounding", "brief_alignment", "brand_voice", "platform_constraints",
    "cta", "safety", "clarity",
]


def passing_assessment() -> dict:
    return {
        "verdict": "accepted",
        "checks": [{
            "dimension": dimension, "status": "pass",
            "rationale": f"The draft passes {dimension} review.",
            "evidenceRefs": ["moment-1"] if dimension in {"grounding", "brief_alignment"} else [],
            "constraintRefs": ["Use an evidence-led voice"] if dimension in {"brand_voice", "safety"} else [],
        } for dimension in DIMENSIONS],
        "issues": [], "resolvedIssueIds": [],
    }


def test_accepts_one_complete_assessment_without_workflow_metadata():
    assessment = EditorialAssessment.model_validate(passing_assessment())

    assert [check.dimension for check in assessment.checks] == DIMENSIONS
    assert assessment.verdict == "accepted"
    assert not {"id", "planId", "draftId", "revision", "reviewedAt"}.intersection(
        assessment.model_dump(mode="json")
    )


@pytest.mark.parametrize("mutation", [
    lambda value: value["checks"].pop(),
    lambda value: value["checks"].append(deepcopy(value["checks"][0])),
    lambda value: value.update(issues=[{
        "id": "issue-1", "category": "clarity", "severity": "medium",
        "fieldPath": "text", "instruction": "Make the sentence clearer.",
        "evidenceRefs": [], "constraintRefs": [],
    }]),
    lambda value: value["checks"][0].update(status="fail"),
])
def test_rejects_incomplete_or_false_acceptance(mutation):
    payload = passing_assessment()
    mutation(payload)
    with pytest.raises(ValidationError):
        EditorialAssessment.model_validate(payload)


def test_revise_requires_failed_check_and_matching_issue_category():
    payload = passing_assessment()
    payload["verdict"] = "revise"
    payload["checks"][-1]["status"] = "fail"
    payload["issues"] = [{
        "id": "issue-clarity", "category": "clarity", "severity": "medium",
        "fieldPath": "text", "instruction": "Make the sentence clearer.",
        "evidenceRefs": [], "constraintRefs": [],
    }]
    assert EditorialAssessment.model_validate(payload).verdict == "revise"

    payload["issues"][0]["category"] = "cta"
    with pytest.raises(ValidationError):
        EditorialAssessment.model_validate(payload)


@pytest.mark.parametrize("field_path", ["replacementCopy", "payload.text", "claims.0.text"])
def test_rejects_open_ended_or_nested_issue_paths(field_path):
    payload = passing_assessment()
    payload["verdict"] = "revise"
    payload["checks"][-1]["status"] = "fail"
    payload["issues"] = [{
        "id": "issue-clarity", "category": "clarity", "severity": "medium",
        "fieldPath": field_path, "instruction": "Make the sentence clearer.",
        "evidenceRefs": [], "constraintRefs": [],
    }]
    with pytest.raises(ValidationError):
        EditorialAssessment.model_validate(payload)


def test_rejects_model_authored_workflow_metadata_and_non_json_containers():
    payload = passing_assessment()
    payload["reviewedAt"] = "2026-08-27T10:00:00Z"
    with pytest.raises(ValidationError):
        EditorialAssessment.model_validate(payload)

    payload = passing_assessment()
    payload["checks"] = tuple(payload["checks"])
    with pytest.raises(ValidationError):
        EditorialAssessment.model_validate(payload)
