"""Authenticated FastAPI boundary for skill-backed operator questions."""

from __future__ import annotations

import hmac
import re
import uuid

from fastapi import APIRouter, HTTPException, Request
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from .agent_errors import AgentContractError
from .agents import AgentProtocolError, ask_with_team_detailed
from .config import settings
from .team_runtime import AgentEngineProviderError, AgentEngineProtocolError
from .tenant_context import tenant_scope
from .usage import InvocationContext

router = APIRouter()
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class OperatorQuestion(BaseModel):
    model_config = {"extra": "forbid"}

    question: str = Field(min_length=1, max_length=2000)


class OperatorAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")

    answer: str
    operationId: str
    traceId: str
    activity: list["SafeToolActivity"]


class SafeToolActivity(BaseModel):
    model_config = ConfigDict(extra="forbid")

    sequence: int = Field(ge=1)
    toolName: str = Field(pattern=r"^[a-z]+(?:_[a-z]+)+$", max_length=80)
    status: Literal["succeeded", "failed"]
    publicMessage: str = Field(min_length=1, max_length=500)
    code: str | None = Field(default=None, pattern=r"^[a-z0-9_]+$", max_length=80)
    category: Literal["validation", "authorization", "not_found", "dependency", "provider_permanent"] | None = None
    retryable: bool | None = None


@router.post("/internal/agent/ask", response_model=OperatorAnswer)
async def operator_ask(payload: OperatorQuestion, request: Request) -> OperatorAnswer:
    supplied = request.headers.get("x-harmonia-internal-token", "")
    if not hmac.compare_digest(supplied, settings().internal_api_token):
        raise HTTPException(status_code=401, detail="unauthorized")
    workspace_id = _required_id(request, "x-workspace-id")
    brand_id = _required_id(request, "x-brand-id")
    user_id = _required_id(request, "x-user-id")
    ask_id = uuid.uuid4().hex[:12]
    trace_id = uuid.uuid4().hex
    invocation = InvocationContext(
        job_id=f"ask-{ask_id}",
        workspace_id=workspace_id,
        brand_id=brand_id,
        user_id=user_id,
        stage="operator_ask",
        operation_id=f"ask-{ask_id}",
    )
    try:
        with tenant_scope(workspace_id, brand_id):
            answer, activity = await ask_with_team_detailed(
                payload.question, invocation=invocation,
            )
    except AgentContractError as exc:
        raise HTTPException(status_code=502, detail={
            "code": exc.code, "category": "protocol", "message": exc.public_message,
            "retryable": False, "role": exc.role, **({"path": exc.path} if exc.path else {}),
        }) from exc
    except (AgentProtocolError, AgentEngineProtocolError) as exc:
        raise HTTPException(status_code=502, detail={
            "code": "liaison_protocol_failed", "category": "protocol",
            "message": "Nova returned a response that did not satisfy its contract.", "retryable": False,
        }) from exc
    except AgentEngineProviderError as exc:
        raise HTTPException(status_code=502, detail={
            "code": "agent_engine_unavailable", "category": "dependency",
            "message": "The agent service is temporarily unavailable.", "retryable": True,
        }) from exc
    return OperatorAnswer(answer=answer, operationId=invocation.operation_id, traceId=trace_id, activity=activity)


def _required_id(request: Request, header: str) -> str:
    value = request.headers.get(header, "")
    if not _ID.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"valid {header} header required")
    return value
