"""Authenticated FastAPI boundary for managed A2UI presentation planning."""

from __future__ import annotations

import hmac
import re

from fastapi import APIRouter, HTTPException, Request

from .a2ui_models import SurfacePlan, UiContext
from .a2ui_presenter import plan_surface
from .agents import AgentProtocolError
from .config import settings
from .team_runtime import AgentEngineProviderError, AgentEngineProtocolError
from .tenant_context import tenant_scope
from .usage import InvocationContext


router = APIRouter()
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


def _required_id(request: Request, header: str) -> str:
    value = request.headers.get(header, "")
    if not _ID.fullmatch(value):
        raise HTTPException(status_code=400, detail=f"valid {header} header required")
    return value


@router.post("/internal/a2ui/plan", response_model=SurfacePlan)
async def create_a2ui_plan(context: UiContext, request: Request) -> SurfacePlan:
    supplied = request.headers.get("x-harmonia-internal-token", "")
    if not hmac.compare_digest(supplied, settings().internal_api_token):
        raise HTTPException(status_code=401, detail="unauthorized")
    workspace_id = _required_id(request, "x-workspace-id")
    brand_id = _required_id(request, "x-brand-id")
    user_id = _required_id(request, "x-user-id")
    if context.job is None:
        raise HTTPException(status_code=422, detail="A2UI presentation requires an active job")
    invocation = InvocationContext(
        job_id=context.job.id,
        workspace_id=workspace_id,
        brand_id=brand_id,
        user_id=user_id,
        stage="presentation",
        operation_id=f"{context.job.id}:presentation:{context.runId}",
    )
    try:
        with tenant_scope(workspace_id, brand_id):
            return await plan_surface(context, invocation=invocation)
    except (AgentProtocolError, AgentEngineProtocolError) as exc:
        raise HTTPException(status_code=502, detail=f"presentation protocol failed: {exc}") from exc
    except AgentEngineProviderError as exc:
        raise HTTPException(status_code=502, detail=f"Agent Engine unavailable: {exc}") from exc

