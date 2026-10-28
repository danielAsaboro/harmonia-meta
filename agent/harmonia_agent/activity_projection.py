"""Construct allow-listed activity records from bounded invocation metadata."""

from __future__ import annotations

import os
from datetime import datetime, timezone
from typing import Literal

from .activity_models import AgentActivityRecord
from .usage import InvocationContext


def _backend() -> Literal["google_cloud", "local"]:
    return "google_cloud" if os.environ.get("K_SERVICE") else "local"


def _error_metadata(error: Exception | None) -> tuple[str | None, str | None]:
    if error is None:
        return None, None
    name = type(error).__name__
    lowered = name.casefold()
    if "timeout" in lowered:
        category = "timeout"
    elif "authorization" in lowered or "permission" in lowered:
        category = "authorization"
    elif "provider" in lowered or "dependency" in lowered or "http" in lowered:
        category = "dependency"
    elif isinstance(error, (ValueError, TypeError)) or "protocol" in lowered or "validation" in lowered:
        category = "protocol"
    else:
        category = "internal"
    return category, name[:128]


def invocation_activity(
    *, invocation: InvocationContext, agent: str, model: str | None,
    trace_id: str, span_id: str, duration_ms: int, input_tokens: int = 0,
    output_tokens: int = 0, inference_calls: int = 0, tool_calls: int = 0,
    error: Exception | None = None,
) -> list[AgentActivityRecord]:
    error_category, error_type = _error_metadata(error)
    common = {
        "workspaceId": invocation.workspace_id,
        "brandId": invocation.brand_id,
        "jobId": invocation.job_id,
        "invocationId": invocation.role_operation_id(agent),
        "operationId": invocation.operation_id,
        "occurredAt": datetime.now(timezone.utc),
        "severity": "error" if error else "info",
        "outcome": "error" if error else "success",
        "agent": agent,
        "stage": invocation.stage,
        "workflow": "harmonia.agent",
        "model": model,
        "traceId": trace_id,
        "spanId": span_id,
        "durationMs": duration_ms,
        "inputTokens": input_tokens,
        "outputTokens": output_tokens,
        "inferenceCalls": inference_calls,
        "toolCalls": tool_calls,
        "errorCategory": error_category,
        "errorType": error_type,
        "backend": _backend(),
    }
    return [
        AgentActivityRecord.model_validate({**common, "signalType": signal, "eventName": event})
        for signal, event in (
            ("log", "agent.lifecycle"),
            ("trace", "agent.invocation"),
            ("metric", "agent.measurement"),
        )
    ]


def tool_activity(
    *, invocation: InvocationContext, agent: str, tool: str, trace_id: str,
    span_id: str, parent_span_id: str, duration_ms: int,
    status: Literal["success", "error"],
) -> AgentActivityRecord:
    return AgentActivityRecord(
        workspaceId=invocation.workspace_id,
        brandId=invocation.brand_id,
        jobId=invocation.job_id,
        invocationId=invocation.role_operation_id(agent),
        operationId=invocation.operation_id,
        occurredAt=datetime.now(timezone.utc),
        signalType="trace",
        eventName="tool.execution",
        severity="error" if status == "error" else "info",
        outcome=status,
        agent=agent,
        stage=invocation.stage,
        workflow="harmonia.agent",
        tool=tool,
        traceId=trace_id,
        spanId=span_id,
        parentSpanId=parent_span_id,
        durationMs=duration_ms,
        errorCategory="dependency" if status == "error" else None,
        errorType="ToolExecutionError" if status == "error" else None,
        backend=_backend(),
    )
