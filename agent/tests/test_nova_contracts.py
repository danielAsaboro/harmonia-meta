"""Strict Nova answer and actual tool-trace contracts."""

import pytest
from pydantic import ValidationError

from harmonia_agent.agent_models import LiaisonAnswer
from harmonia_agent.nova_liaison import validate_liaison_answer


def envelope(*, status="success", retryable=False):
    if status == "success":
        return {"status": "success", "data": {"found": True}, "error": None,
                "evidence": [{"evidenceId": "ev-aaaaaaaaaaaaaaaa", "source": "harmonia_firestore_job", "provenance": "live", "reference": "job-1"}]}
    return {"status": "error", "data": None,
            "error": {"code": "dependency_unavailable", "category": "dependency", "message": "Unavailable.", "retryable": retryable}, "evidence": []}


def trace(response=None):
    return [
        {"sequence": 1, "name": "load_skill", "args": {"skill_name": "job-status"}, "response": {"loaded": "job-status"}},
        {"sequence": 2, "name": "get_job_status", "args": {"job_id": "job-1"}, "response": response or envelope()},
    ]


def answer():
    return {"status": "success", "answer": "Job job-1 is available [ev-aaaaaaaaaaaaaaaa].", "skillName": "job-status",
            "claims": [{"text": "Job job-1 is available", "evidenceIds": ["ev-aaaaaaaaaaaaaaaa"]}],
            "error": None, "uncertainty": []}


def test_accepts_grounded_answer_bound_to_actual_skill_and_tool_trace():
    parsed = LiaisonAnswer.model_validate(answer())
    assert validate_liaison_answer(parsed, trace()).answer.startswith("Job job-1")


@pytest.mark.parametrize("field", ["status", "answer", "skillName", "claims", "error", "uncertainty"])
def test_answer_requires_complete_strict_contract(field):
    value = answer(); del value[field]
    with pytest.raises(ValidationError): LiaisonAnswer.model_validate(value)


@pytest.mark.parametrize(("mutation", "message"), [
    (lambda value, calls: value["claims"][0].update(evidenceIds=["invented"]), "unknown evidence"),
    (lambda value, calls: calls.pop(0), "load exactly one skill first"),
    (lambda value, calls: calls[1].update(name="fetch_trend_signals"), "not allowed by skill"),
    (lambda value, calls: value.update(answer="I approved and published it [ev-aaaaaaaaaaaaaaaa]."), "authority"),
])
def test_rejects_invented_evidence_wrong_trajectory_and_authority(mutation, message):
    value, calls = answer(), trace(); mutation(value, calls)
    with pytest.raises(ValueError, match=message):
        validate_liaison_answer(LiaisonAnswer.model_validate(value), calls)


def test_error_answer_must_report_exact_last_error_and_retry_policy():
    calls = trace(envelope(status="error", retryable=False))
    value = {"status": "error", "answer": "Read failed: dependency_unavailable.", "skillName": "job-status",
             "claims": [], "error": {"code": "dependency_unavailable", "category": "dependency", "message": "Unavailable.", "retryable": False}, "uncertainty": []}
    assert validate_liaison_answer(LiaisonAnswer.model_validate(value), calls).status == "error"
    calls.append({**calls[-1], "sequence": 3})
    with pytest.raises(ValueError, match="retry"):
        validate_liaison_answer(LiaisonAnswer.model_validate(value), calls)


def test_rejects_out_of_order_trace_and_false_no_data_answer():
    calls = trace()
    calls[1]["sequence"] = 3
    with pytest.raises(ValueError, match="sequence"):
        validate_liaison_answer(LiaisonAnswer.model_validate(answer()), calls)

    value = {"status": "no_data", "answer": "No matching records were found.", "skillName": "job-status",
             "claims": [], "error": None, "uncertainty": ["No records matched."]}
    with pytest.raises(ValueError, match="no_data"):
        validate_liaison_answer(LiaisonAnswer.model_validate(value), trace())


def test_rejects_multiple_data_tool_choices_for_one_answer():
    value = answer(); value["skillName"] = "posting-schedule"
    calls = [
        {"sequence": 1, "name": "load_skill", "args": {"skill_name": "posting-schedule"}, "response": {}},
        {"sequence": 2, "name": "get_engagement_insights", "args": {}, "response": envelope()},
        {"sequence": 3, "name": "suggest_posting_windows", "args": {}, "response": envelope()},
    ]
    with pytest.raises(ValueError, match="one data-tool attempt"):
        validate_liaison_answer(LiaisonAnswer.model_validate(value), calls)
