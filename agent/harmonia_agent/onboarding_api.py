"""Authenticated boundary for website onboarding (site -> cited Brand Brief)."""

from __future__ import annotations

import asyncio
import hmac
import logging
import re

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from .brand_onboarding import OnboardingError, onboard_website
from .config import settings
from .tenant_context import tenant_scope
from .web_client import post as web_post

logger = logging.getLogger("harmonia.onboarding")

router = APIRouter()
_ID = re.compile(r"^[A-Za-z0-9_-]{1,128}$")


class OnboardingRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=3, max_length=500)
    channels: list[str] = Field(default_factory=lambda: ["x", "linkedin"], min_length=1, max_length=8)
    runId: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{1,128}$")


def progress_reporter(run_id: str | None):
    """Report each step to the web run record; progress is best effort and never fails onboarding."""
    if run_id is None:
        return None

    async def report(step: str, status: str, detail: str | None) -> None:
        payload = {"runId": run_id, "step": step, "status": status, **({"detail": detail} if detail else {})}
        try:
            await asyncio.to_thread(web_post, "/api/internal/onboarding/progress", payload)
        except Exception as exc:  # noqa: BLE001 - progress is advisory
            logger.warning("onboarding progress report failed for %s/%s: %s", run_id, step, exc)

    return report


@router.post("/internal/agent/onboard-website")
async def onboard(payload: OnboardingRequest, request: Request) -> dict:
    supplied = request.headers.get("x-harmonia-internal-token", "")
    if not hmac.compare_digest(supplied, settings().internal_api_token):
        raise HTTPException(status_code=401, detail="unauthorized")
    workspace_id = request.headers.get("x-workspace-id", "")
    brand_id = request.headers.get("x-brand-id", "")
    if not all(_ID.fullmatch(value) for value in (workspace_id, brand_id)):
        raise HTTPException(status_code=400, detail="valid tenant headers required")
    try:
        with tenant_scope(workspace_id, brand_id):
            return await onboard_website(payload.url, channels=payload.channels, progress=progress_reporter(payload.runId))
    except OnboardingError as exc:
        raise HTTPException(status_code=502, detail={
            "code": "website_onboarding_failed", "category": "dependency",
            "message": str(exc)[:240], "retryable": True,
        }) from exc
