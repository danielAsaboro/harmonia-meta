"""Focused ADK lifecycle callbacks for safe, typed failure evidence."""

from __future__ import annotations

from typing import Any

from google.adk.agents.context import Context
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools.base_tool import BaseTool


def _status(error: Exception) -> int | None:
    for name in ("status_code", "status", "code"):
        value = getattr(error, name, None)
        if isinstance(value, int) and 100 <= value <= 599:
            return value
    return None


def record_model_error(
    callback_context: Context, llm_request: LlmRequest, error: Exception,
) -> LlmResponse | None:
    """Record non-content-bearing provider evidence and let ADK re-raise."""
    del llm_request
    evidence: dict[str, Any] = {
        "kind": "model_error",
        "errorType": type(error).__name__,
    }
    if (status := _status(error)) is not None:
        evidence["status"] = status
    callback_context.state["temp:harmonia_model_error"] = evidence
    return None


def record_tool_error(
    tool: BaseTool, args: dict[str, Any], tool_context: Context, error: Exception,
) -> dict[str, Any]:
    """Return a bounded error envelope so the active specialist can recover."""
    del args
    status = _status(error)
    retryable = status == 429 or (status is not None and status >= 500)
    evidence: dict[str, Any] = {
        "kind": "tool_error",
        "tool": tool.name,
        "errorType": type(error).__name__,
        "retryable": retryable,
    }
    if status is not None:
        evidence["status"] = status
    tool_context.state["temp:harmonia_tool_error"] = evidence
    return {
        "status": "error",
        "error": {
            "code": "tool_temporarily_unavailable" if retryable else "tool_request_rejected",
            "retryable": retryable,
        },
    }
