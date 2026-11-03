"""Deterministic tests for the bounded Noni-Dara production protocol."""

from __future__ import annotations

from copy import deepcopy

import pytest

from harmonia_agent.agent_models import DraftWorkflowResult
from harmonia_agent.agents import AgentProtocolError, run_noni_dara_loop
from tests.test_noni_contracts import (
    editorial_checks,
    grounded_draft,
    grounded_revision_draft,
    original_input,
    revise_review,
)


def accepted_assessment(*, resolved: list[str] | None = None) -> dict:
    return {
        "verdict": "accepted",
        "checks": editorial_checks(), "issues": [],
        "resolvedIssueIds": resolved or [],
    }


def revise_assessment(review: dict | None = None) -> dict:
    value = deepcopy(review or revise_review())
    return {key: value[key] for key in ("verdict", "checks", "issues", "resolvedIssueIds")}


def _accept_original():
    calls: list[tuple[str, int | str]] = []
    draft = grounded_draft()

    def invoke_noni(supplied):
        calls.append(("noni", supplied.passType))
        return draft

    def invoke_dara(supplied, reviewed_draft):
        assert supplied.passType == "original"
        calls.append(("dara", reviewed_draft.revision))
        return accepted_assessment()

    return run_noni_dara_loop(original_input(), invoke_noni, invoke_dara), calls


def test_accepts_the_exact_original_without_a_revision():
    result, calls = _accept_original()

    assert isinstance(result, DraftWorkflowResult)
    assert result.originalDraft.id == "draft-1"
    assert result.revisionDraft is None
    assert [review.verdict for review in result.reviews] == ["accepted"]
    assert result.acceptedDraft == result.originalDraft
    assert calls == [("noni", "original"), ("dara", 1)]


def test_runs_one_requested_revision_then_accepts_the_exact_revision():
    calls: list[tuple[str, int | str]] = []
    original = grounded_draft()
    revision = grounded_revision_draft()
    first_review = revise_review()
    first_assessment = revise_assessment(first_review)

    def invoke_noni(supplied):
        calls.append(("noni", supplied.passType))
        if supplied.passType == "original":
            return original
        assert supplied.priorDraft.model_dump(mode="json") == original
        assert supplied.priorReview.issues[0].id == "issue-1"
        return revision

    def invoke_dara(_supplied, draft):
        calls.append(("dara", draft.revision))
        return first_assessment if draft.revision == 1 else accepted_assessment(resolved=["issue-1"])

    result = run_noni_dara_loop(original_input(), invoke_noni, invoke_dara)

    assert result.originalDraft.id == "draft-1"
    assert result.revisionDraft is not None and result.revisionDraft.id == "draft-2"
    assert len({review.id for review in result.reviews}) == 2
    assert result.reviews[1].resolvedIssueIds == ["issue-1"]
    assert result.acceptedDraft == result.revisionDraft
    assert calls == [
        ("noni", "original"), ("dara", 1),
        ("noni", "revision"), ("dara", 2),
    ]


@pytest.mark.parametrize(("field", "value"), [
    ("planId", "plan-invented"),
    ("draftId", "draft-invented"),
    ("revision", 2),
])
def test_rejects_model_authored_review_metadata_before_any_revision(field, value):
    assessment = revise_assessment()
    assessment[field] = value
    noni_calls = 0

    def invoke_noni(_supplied):
        nonlocal noni_calls
        noni_calls += 1
        return grounded_draft()

    with pytest.raises(AgentProtocolError, match="invalid Dara review"):
        run_noni_dara_loop(original_input(), invoke_noni, lambda *_: assessment)

    assert noni_calls == 1


def test_rejects_invented_review_evidence_before_revision():
    assessment = revise_assessment()
    assessment["issues"][0]["evidenceRefs"] = ["evidence-invented"]
    noni_calls = 0

    def invoke_noni(_supplied):
        nonlocal noni_calls
        noni_calls += 1
        return grounded_draft()

    with pytest.raises(AgentProtocolError, match="unknown evidence"):
        run_noni_dara_loop(original_input(), invoke_noni, lambda *_: assessment)

    assert noni_calls == 1


def test_rejects_a_dara_replacement_copy_field():
    assessment = accepted_assessment()
    assessment["replacementCopy"] = "Use this replacement instead."

    with pytest.raises(AgentProtocolError, match="invalid Dara review"):
        run_noni_dara_loop(
            original_input(), lambda _: grounded_draft(), lambda *_: assessment,
        )


def test_rejects_a_revision_missing_issue_ids():
    revision = grounded_revision_draft()
    revision["addressedIssueIds"] = []

    with pytest.raises(AgentProtocolError, match="invalid Noni draft"):
        run_noni_dara_loop(
            original_input(),
            lambda supplied: grounded_draft() if supplied.passType == "original" else revision,
            lambda _supplied, draft: revise_assessment() if draft.revision == 1 else accepted_assessment(resolved=["issue-1"]),
        )


def test_rejects_a_revision_that_ignores_one_required_issue():
    review = revise_review()
    second_issue = deepcopy(review["issues"][0])
    second_issue["id"] = "issue-2"
    review["issues"].append(second_issue)

    with pytest.raises(AgentProtocolError, match="addressed issue ids"):
        run_noni_dara_loop(
            original_input(),
            lambda supplied: (
                grounded_draft()
                if supplied.passType == "original"
                else grounded_revision_draft()
            ),
            lambda _supplied, draft: revise_assessment(review) if draft.revision == 1 else accepted_assessment(resolved=["issue-1", "issue-2"]),
        )


def test_second_revise_fails_closed_without_a_third_noni_invocation():
    noni_calls = 0
    dara_calls = 0

    def invoke_noni(supplied):
        nonlocal noni_calls
        noni_calls += 1
        return grounded_draft() if supplied.passType == "original" else grounded_revision_draft()

    def invoke_dara(_supplied, draft):
        nonlocal dara_calls
        dara_calls += 1
        return revise_assessment()

    with pytest.raises(AgentProtocolError, match="second Dara revise verdict"):
        run_noni_dara_loop(original_input(), invoke_noni, invoke_dara)

    assert noni_calls == 2
    assert dara_calls == 2


@pytest.mark.parametrize("issue_id", ["", "issue-1"])
def test_rejects_empty_or_duplicate_review_issue_ids(issue_id):
    review = revise_assessment()
    if issue_id:
        review["issues"].append(deepcopy(review["issues"][0]))
    else:
        review["issues"][0]["id"] = issue_id

    with pytest.raises(AgentProtocolError, match="invalid Dara review"):
        run_noni_dara_loop(
            original_input(), lambda _: grounded_draft(), lambda *_: review,
        )


def test_accepts_unicode_in_grounding_input_before_the_first_noni_invocation():
    supplied = original_input()
    supplied["brandContext"] = "Direct and concise. 立即发布."
    calls = 0

    def invoke_noni(_supplied):
        nonlocal calls
        calls += 1
        return grounded_draft()

    result = run_noni_dara_loop(
        supplied, invoke_noni, lambda *_: accepted_assessment(),
    )

    assert result.acceptedDraft.id == "draft-1"
    assert calls == 1
