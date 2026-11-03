"""Safe, strict agent activity projection contracts."""

from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from harmonia_agent.activity_models import AgentActivityRecord
from harmonia_agent.activity_projection import invocation_activity, tool_activity
from harmonia_agent.usage import InvocationContext


def context() -> InvocationContext:
    return InvocationContext(
        job_id="job-1", workspace_id="workspace-1", brand_id="brand-1",
        user_id="user-1", stage="strategize", operation_id="op-1",
    )


def valid_activity() -> dict:
    return {
        "schemaVersion": 1,
        "workspaceId": "workspace-1",
        "brandId": "brand-1",
        "jobId": "job-1",
        "invocationId": "op-1:ryan_strategist",
        "operationId": "op-1",
        "occurredAt": datetime.now(timezone.utc).isoformat(),
        "signalType": "trace",
        "eventName": "agent.invocation",
        "severity": "info",
        "outcome": "success",
        "agent": "ryan_strategist",
        "stage": "strategize",
        "model": "muse-spark-1.3",
        "traceId": "a" * 32,
        "spanId": "b" * 16,
        "durationMs": 120,
        "inputTokens": 40,
        "outputTokens": 20,
        "inferenceCalls": 1,
        "toolCalls": 0,
        "backend": "google_cloud",
    }


def test_activity_record_rejects_content_and_unknown_fields():
    payload = valid_activity()
    payload["prompt"] = "private"
    with pytest.raises(ValidationError):
        AgentActivityRecord.model_validate(payload)


def test_invocation_projection_emits_log_trace_and_metric_without_private_error():
    records = invocation_activity(
        invocation=context(), agent="ryan_strategist", model="muse-spark-1.3",
        trace_id="a" * 32, span_id="b" * 16, duration_ms=125,
        input_tokens=40, output_tokens=20, inference_calls=1, tool_calls=0,
        error=ValueError("token=private-secret"),
    )
    assert {record.signalType for record in records} == {"log", "trace", "metric"}
    assert all(record.outcome == "error" for record in records)
    assert all(record.errorCategory == "protocol" for record in records)
    assert "private-secret" not in "".join(record.model_dump_json() for record in records)


def test_tool_projection_is_bound_to_parent_invocation_and_safe_envelope_status():
    record = tool_activity(
        invocation=context(), agent="nova_liaison", tool="get_job_status",
        trace_id="a" * 32, span_id="c" * 16, parent_span_id="b" * 16,
        duration_ms=8, status="success",
    )
    assert record.signalType == "trace"
    assert record.eventName == "tool.execution"
    assert record.parentSpanId == "b" * 16
    assert record.tool == "get_job_status"
    assert "response" not in record.model_dump(mode="json")
