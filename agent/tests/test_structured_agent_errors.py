"""Stable, safe errors shared by agent handoffs and tool calls."""

import pytest
from pydantic import ValidationError

from harmonia_agent.agent_errors import AgentContractError
from harmonia_agent.agent_models import LiaisonAnswer
from harmonia_agent.agent_models import LiaisonInput
from harmonia_agent.agents import _validate_run_output
from harmonia_agent.failures import normalize_failure
from harmonia_agent.tool_contracts import ToolEnvelope, validate_tool_envelope


def test_agent_contract_error_survives_failure_normalization():
    error = AgentContractError(
        role="dara_editor",
        code="unknown_evidence_reference",
        public_message="Dara cited evidence that was not supplied.",
        path="checks.0.evidenceRefs.1",
    )

    envelope = normalize_failure(
        error,
        stage="draft",
        operation_id="job-1:draft:0",
        trace_id="a" * 32,
        attempt=0,
    )

    assert envelope.code == "unknown_evidence_reference"
    assert envelope.category == "protocol"
    assert envelope.public_message == "Dara cited evidence that was not supplied."
    assert envelope.details == {
        "exceptionType": "AgentContractError",
        "role": "dara_editor",
        "path": "checks.0.evidenceRefs.1",
    }


def test_tool_envelope_is_a_strict_discriminated_contract():
    parsed = validate_tool_envelope({
        "status": "error",
        "data": None,
        "error": {
            "code": "dependency_unavailable",
            "category": "dependency",
            "message": "The source is unavailable.",
            "retryable": True,
        },
        "evidence": [],
    })
    assert isinstance(parsed, ToolEnvelope)
    assert parsed.error.retryable is True

    with pytest.raises(ValidationError):
        validate_tool_envelope({
            "status": "error", "data": {"leaked": True},
            "error": {"code": "bad", "category": "dependency", "message": "bad", "retryable": False},
            "evidence": [{"evidenceId": "invented"}],
        })


def test_liaison_error_retains_tool_category_and_retryability():
    parsed = LiaisonAnswer.model_validate({
        "status": "error",
        "answer": "Read failed: dependency_unavailable.",
        "skillName": "job-status",
        "claims": [],
        "error": {
            "code": "dependency_unavailable",
            "category": "dependency",
            "message": "The source is unavailable.",
            "retryable": True,
        },
        "uncertainty": [],
    })
    assert parsed.error is not None
    assert parsed.error.category == "dependency"
    assert parsed.error.retryable is True


def test_specialist_output_validation_raises_role_bound_error():
    with pytest.raises(AgentContractError) as raised:
        _validate_run_output("nova_liaison", LiaisonInput(question="status"), {})

    assert raised.value.role == "nova_liaison"
    assert raised.value.code == "invalid_agent_output"
    assert raised.value.path == "output"
    assert str(raised.value) == "Nova returned output that did not satisfy its contract."
