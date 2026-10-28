"""Authenticated boundary for Harmonia's context-first intent router."""

from __future__ import annotations

import hmac
import re
import uuid

from fastapi import APIRouter, HTTPException, Request

from .agent_errors import AgentContractError
from .agents import AgentProtocolError, route_intent_with_team
from .config import settings
from .intent_routing import IntentRoute, IntentRoutingInput
from .team_runtime import AgentEngineProviderError, AgentEngineProtocolError
from .tenant_context import tenant_scope
from .usage import InvocationContext

router = APIRouter()
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


@router.post("/internal/agent/route", response_model=IntentRoute)
async def route_operator_intent(payload: IntentRoutingInput, request: Request) -> IntentRoute:
    supplied = request.headers.get("x-harmonia-internal-token", "")
    if not hmac.compare_digest(supplied, settings().internal_api_token):
        raise HTTPException(status_code=401, detail="unauthorized")
    workspace_id = request.headers.get("x-workspace-id", "")
    brand_id = request.headers.get("x-brand-id", "")
    user_id = request.headers.get("x-user-id", "")
    if not all(_ID.fullmatch(value) for value in (workspace_id, brand_id, user_id)):
        raise HTTPException(status_code=400, detail="valid tenant headers required")
    route_id = uuid.uuid4().hex[:12]
    invocation = InvocationContext(
        job_id=f"route-{route_id}", workspace_id=workspace_id, brand_id=brand_id,
        user_id=user_id, stage="intent_route", operation_id=f"route-{route_id}",
    )
    try:
        with tenant_scope(workspace_id, brand_id):
            return await route_intent_with_team(payload, invocation=invocation)
    except AgentContractError as exc:
        raise HTTPException(status_code=502, detail={
            "code": exc.code, "category": "protocol", "message": exc.public_message,
            "retryable": False, "role": exc.role, **({"path": exc.path} if exc.path else {}),
        }) from exc
    except (AgentProtocolError, AgentEngineProtocolError) as exc:
        code, message = _safe_protocol_failure(exc)
        raise HTTPException(status_code=502, detail={
            "code": code, "category": "protocol", "message": message, "retryable": False,
        }) from exc
    except AgentEngineProviderError as exc:
        raise HTTPException(status_code=502, detail={
            "code": "agent_engine_unavailable", "category": "dependency",
            "message": "Harmonia's reasoning service is temporarily unavailable.", "retryable": True,
        }) from exc


def _safe_protocol_failure(exc: Exception) -> tuple[str, str]:
    """Map known host-generated protocol faults without exposing model content."""
    reason = str(exc)
    if "required state key: intent_route" in reason or "returned no state delta" in reason:
        return (
            "agent_engine_missing_route_state",
            "The reasoning service completed without Harmonia's required route state.",
        )
    if "live platform connection lookup failed" in reason:
        return (
            "platform_connection_lookup_failed",
            "Harmonia could not read the live platform connection registry.",
        )
    return "intent_route_protocol_failed", "Harmonia could not validate its routing result."
