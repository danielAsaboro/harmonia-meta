"""Deterministic trace capture and grounding validation for Nova."""

from __future__ import annotations

import re
from typing import Any

from google.adk.agents.context import Context
from google.adk.tools.base_tool import BaseTool

from .agent_models import LiaisonAnswer
from .skills_runtime import _TOOL_CONTRACTS
from .tool_contracts import error as tool_error, validate_tool_envelope
from .telemetry import current_span_id, current_trace_id

TRACE_KEY = "liaison_tool_trace"
_AUTHORITY = re.compile(
    r"\b(?:i|we|harmonia)\s+(?:have\s+|has\s+)?(?:approved|rejected|published|executed|"
    r"scheduled|verified|authorized)|\b(?:approval|publishing|execution)\s+receipt\b",
    re.IGNORECASE,
)
_META_TOOLS = frozenset({"load_skill", "load_skill_resource"})


def reset_liaison_trace(callback_context: Context) -> None:
    callback_context.state[TRACE_KEY] = []


def record_liaison_tool(
    tool: BaseTool, args: dict[str, Any], tool_context: Context, tool_response: dict[str, Any],
) -> None:
    trace = list(tool_context.state.get(TRACE_KEY) or [])
    trace.append({
        "sequence": len(trace) + 1,
        "name": tool.name,
        "args": dict(args),
        "response": tool_response,
        "traceId": current_trace_id(),
        "spanId": current_span_id(),
    })
    tool_context.state[TRACE_KEY] = trace


def record_liaison_tool_error(
    tool: BaseTool, args: dict[str, Any], tool_context: Context, error: Exception,
) -> dict[str, Any]:
    response = tool_error(
        "tool_execution_failed",
        "The read tool failed before returning a valid envelope.",
        category="dependency",
        retryable=False,
    )
    record_liaison_tool(tool, args, tool_context, response)
    return response


def _loaded_skill(entry: dict[str, Any]) -> str | None:
    args = entry.get("args") or {}
    value = args.get("skill_name") or args.get("name")
    return value if isinstance(value, str) else None


def validate_liaison_answer(answer: LiaisonAnswer, trace: list[dict[str, Any]]) -> LiaisonAnswer:
    """Bind Nova's typed answer to the actual skill/tool sequence and envelopes."""
    if not trace or trace[0].get("name") != "load_skill" or sum(item.get("name") == "load_skill" for item in trace) != 1:
        raise ValueError("Nova must load exactly one skill first")
    if [item.get("sequence") for item in trace] != list(range(1, len(trace) + 1)):
        raise ValueError("Nova tool trace sequence is invalid")
    loaded = _loaded_skill(trace[0])
    if loaded != answer.skillName:
        raise ValueError("Nova answer skill does not match the actually loaded skill")
    data_calls = [item for item in trace if item.get("name") not in _META_TOOLS]
    if not data_calls:
        raise ValueError("Nova must call at least one read tool after loading a skill")
    for item in trace[1:]:
        name = item.get("name")
        if name == "load_skill_resource":
            continue
        contract = _TOOL_CONTRACTS.get(str(name))
        if contract is None or answer.skillName not in contract.skill_names:
            raise ValueError(f"Nova tool {name} is not allowed by skill {answer.skillName}")
    by_name: dict[str, list[dict[str, Any]]] = {}
    for item in data_calls:
        by_name.setdefault(str(item.get("name")), []).append(item)
    if len(by_name) != 1:
        raise ValueError("Nova must use one data-tool attempt path per answer")
    for name, calls in by_name.items():
        if len(calls) > 2:
            raise ValueError(f"Nova exceeded the retry ceiling for {name}")
        if len(calls) == 2:
            first_error = (calls[0].get("response") or {}).get("error") or {}
            if (calls[0].get("response") or {}).get("status") != "error" or first_error.get("retryable") is not True:
                raise ValueError(f"Nova retried {name} without a retryable error")

    evidence_ids: set[str] = set()
    last_response: dict[str, Any] = {}
    for item in data_calls:
        response = item.get("response")
        if not isinstance(response, dict):
            raise ValueError("Nova tool trace contains an invalid envelope")
        try:
            envelope = validate_tool_envelope(response)
        except ValueError as exc:
            raise ValueError("Nova tool trace contains an invalid envelope") from exc
        last_response = envelope.model_dump(mode="json", exclude_none=False)
        if envelope.status == "success":
            evidence_ids.update(item.evidenceId for item in envelope.evidence)

    if _AUTHORITY.search(answer.answer):
        raise ValueError("Nova answer claims mutation authority")
    normalized_answer = answer.answer.casefold()
    for claim in answer.claims:
        if claim.text.casefold() not in normalized_answer:
            raise ValueError("Nova claim text is absent from the operator answer")
        unknown = set(claim.evidenceIds) - evidence_ids
        if unknown:
            raise ValueError(f"Nova claim cites unknown evidence ids: {sorted(unknown)}")
        if any(evidence_id.casefold() not in normalized_answer for evidence_id in claim.evidenceIds):
            raise ValueError("Nova answer must display every claim evidence id")

    if answer.status == "error":
        actual_error = last_response.get("error") if last_response.get("status") == "error" else None
        if not isinstance(actual_error, dict) or answer.error is None:
            raise ValueError("Nova error answer is not bound to the final tool error")
        if (
            answer.error.code != actual_error.get("code")
            or answer.error.category != actual_error.get("category")
            or answer.error.message != actual_error.get("message")
            or answer.error.retryable is not actual_error.get("retryable")
        ):
            raise ValueError("Nova error answer must preserve the exact final tool error")
        if answer.error.code.casefold() not in normalized_answer:
            raise ValueError("Nova answer must display the typed error code")
    elif last_response.get("status") == "error":
        raise ValueError("Nova cannot report success after an unresolved final tool error")
    if answer.status == "no_data" and _response_has_data(last_response.get("data")):
        raise ValueError("Nova cannot report no_data when the read tool returned records")
    return answer


def _response_has_data(data: Any) -> bool:
    if not isinstance(data, dict):
        return False
    if data.get("found") is True or isinstance(data.get("count"), int) and data["count"] > 0:
        return True
    record_keys = ("signals", "topPosts", "windows", "pendingItems", "recentPublished", "jobs")
    return any(isinstance(data.get(key), list) and bool(data[key]) for key in record_keys)
