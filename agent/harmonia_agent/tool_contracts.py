"""Least-privilege contracts and value-free error envelopes for ADK tools."""

from __future__ import annotations

from hashlib import sha256
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .web_client import WebApiError


class ToolContract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    name: str = Field(pattern=r"^[a-z]+(?:_[a-z]+)+$", max_length=80)
    purpose: str = Field(min_length=20, max_length=300)
    input_schema: dict[str, str]
    return_schema: str = Field(min_length=10)
    error_codes: tuple[str, ...] = Field(min_length=1)
    permission: Literal["read"]
    data_scope: Literal["public", "workspace"]
    timeout_seconds: int = Field(ge=1, le=120)
    retry: Literal["none", "one_transient_retry"]
    external_effect: Literal[False]
    skill_names: tuple[str, ...] = Field(min_length=1)


class ToolEvidence(BaseModel):
    model_config = ConfigDict(extra="forbid")

    evidenceId: str = Field(pattern=r"^ev-[a-f0-9]{16}$")
    source: str = Field(min_length=1, max_length=120)
    provenance: Literal["live", "mock"]
    reference: str | None = Field(default=None, max_length=2_000)


class ToolError(BaseModel):
    model_config = ConfigDict(extra="forbid")

    code: str = Field(pattern=r"^[a-z0-9_]{1,80}$")
    category: Literal["validation", "authorization", "not_found", "dependency", "provider_permanent"]
    message: str = Field(min_length=1, max_length=500)
    retryable: bool


class ToolEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    status: Literal["success", "error"]
    data: dict[str, Any] | None
    error: ToolError | None
    evidence: list[ToolEvidence] = Field(max_length=100)

    @model_validator(mode="after")
    def validate_shape(self) -> "ToolEnvelope":
        if self.status == "success" and (self.data is None or self.error is not None):
            raise ValueError("successful tool envelope requires data and no error")
        if self.status == "error" and (self.data is not None or self.error is None or self.evidence):
            raise ValueError("error tool envelope requires one error, null data, and no evidence")
        return self


def validate_tool_envelope(value: dict[str, Any]) -> ToolEnvelope:
    return ToolEnvelope.model_validate(value)


def evidence(source: str, *, provenance: Literal["live", "mock"], reference: str | None = None) -> dict[str, Any]:
    material = f"{source}|{provenance}|{reference or ''}"
    evidence_id = f"ev-{sha256(material.encode()).hexdigest()[:16]}"
    return {
        "evidenceId": evidence_id,
        "source": source,
        "provenance": provenance,
        **({"reference": reference} if reference else {}),
    }


def success(data: dict[str, Any], *, evidence_items: list[dict[str, Any]]) -> dict[str, Any]:
    return ToolEnvelope.model_validate(
        {"status": "success", "data": data, "error": None, "evidence": evidence_items},
    ).model_dump(mode="json", exclude_none=False)


def error(code: str, message: str, *, category: str, retryable: bool) -> dict[str, Any]:
    return ToolEnvelope.model_validate({
        "status": "error",
        "data": None,
        "error": {"code": code, "category": category, "message": message, "retryable": retryable},
        "evidence": [],
    }).model_dump(mode="json", exclude_none=False)


def provider_error(exc: Exception) -> dict[str, Any]:
    status = exc.status if isinstance(exc, WebApiError) else None
    if status in (401, 403):
        return error("authorization_failed", "The workspace data source is not authorized.", category="authorization", retryable=False)
    if status is not None and status < 500 and status != 429:
        return error("provider_request_rejected", "The data source rejected this read request.", category="provider_permanent", retryable=False)
    return error("dependency_unavailable", "The required data source is temporarily unavailable.", category="dependency", retryable=True)
