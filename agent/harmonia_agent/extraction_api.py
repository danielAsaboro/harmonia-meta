"""Authenticated source normalization endpoint for brand-library synchronization."""
from __future__ import annotations
import asyncio
import base64
import hmac
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from .config import settings
from .extraction import extract_docx, extract_media, extract_pdf, extract_text
from .extraction.preflight import ExtractionLimits, estimate_extraction
from .tenant_context import tenant_scope
from .usage import InvocationContext

router = APIRouter()
class ExtractionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sourceId: str = Field(min_length=1); title: str = Field(min_length=1, max_length=500); mimeType: str = Field(min_length=1)
    bodyBase64: str = Field(min_length=1, max_length=30_000_000); receiptId: str = Field(min_length=1)
    limits: ExtractionLimits

def _extract(value: ExtractionRequest, invocation: InvocationContext):
    body = base64.b64decode(value.bodyBase64, validate=True)
    mime = value.mimeType.split(";", 1)[0].lower()
    estimate_extraction(body, mime, value.limits)
    if mime == "application/pdf": return extract_pdf(value.sourceId, value.title, body, receipt_id=value.receiptId)
    if mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document": return extract_docx(value.sourceId, value.title, body, receipt_id=value.receiptId)
    if mime.startswith("text/"): return extract_text(value.sourceId, value.title, body.decode("utf-8"), mime, receipt_id=value.receiptId)
    if mime.startswith(("audio/", "video/")): return extract_media(value.sourceId, value.title, body, mime, invocation=invocation, receipt_id=value.receiptId)
    raise ValueError(f"unsupported library source type: {mime}")

@router.post("/internal/sources/extract")
async def extract_source(value: ExtractionRequest, x_harmonia_internal_token: str = Header(default=""), x_workspace_id: str = Header(default=""), x_brand_id: str = Header(default=""), x_user_id: str = Header(default="system")):
    if not hmac.compare_digest(x_harmonia_internal_token, settings().internal_api_token): raise HTTPException(status_code=401, detail="unauthorized")
    if not x_workspace_id or not x_brand_id: raise HTTPException(status_code=400, detail="tenant headers required")
    invocation = InvocationContext(job_id=f"library:{value.sourceId}", workspace_id=x_workspace_id, brand_id=x_brand_id, user_id=x_user_id, stage="extract_sources", operation_id=value.receiptId)
    try:
        with tenant_scope(x_workspace_id, x_brand_id): result = await asyncio.to_thread(_extract, value, invocation)
        return result.model_dump(mode="json")
    except ValueError as exc: raise HTTPException(status_code=422, detail=str(exc)) from exc
