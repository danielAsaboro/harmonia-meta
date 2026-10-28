"""Safe, typed failure normalization and the single worker retry policy."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

import httpx
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from .agents import AgentProtocolError
from .agent_errors import AgentContractError
from .generative_media import MediaProtocolError, MediaProviderError
from .memory_bank import MemoryProtocolError, MemoryProviderError
from .model_catalog import UnknownModelPrice
from .team_runtime import AgentEngineProtocolError, AgentEngineProviderError
from .web_client import (
    ConnectionAuthorizationError,
    EffectClaimInProgress,
    EffectClaimUncertain,
    WebApiError,
)
from .x_client import XError
from .youtube import IngestError

MAX_STAGE_ATTEMPTS = 3


class FailureCategory(StrEnum):
    VALIDATION = "validation"
    AUTHORIZATION = "authorization"
    POLICY = "policy"
    BUDGET = "budget"
    PROVIDER_TRANSIENT = "provider_transient"
    PROVIDER_PERMANENT = "provider_permanent"
    DEPENDENCY = "dependency"
    PROTOCOL = "protocol"


PUBLIC_MESSAGES = {
    FailureCategory.VALIDATION: "Stage input or output did not satisfy its contract.",
    FailureCategory.AUTHORIZATION: "A required service authorization is missing or insufficient.",
    FailureCategory.POLICY: "Operator or policy action is required before this stage can continue.",
    FailureCategory.BUDGET: "The stage is not authorized under the current budget or pricing policy.",
    FailureCategory.PROVIDER_TRANSIENT: "A provider is temporarily unavailable; Harmonia will retry safely.",
    FailureCategory.PROVIDER_PERMANENT: "A provider rejected or does not support this operation.",
    FailureCategory.DEPENDENCY: "A required dependency is temporarily unavailable.",
    FailureCategory.PROTOCOL: "A provider or agent returned an invalid response.",
}


class FailureEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    category: FailureCategory
    code: str = Field(min_length=1, max_length=80, pattern=r"^[a-z0-9_]+$")
    public_message: str = Field(min_length=1, max_length=240)
    retryable: bool
    stage: str = Field(min_length=1, max_length=80)
    operation_id: str = Field(min_length=1, max_length=240)
    trace_id: str = Field(pattern=r"^[a-f0-9]{32}$")
    attempt: int = Field(ge=0)
    max_attempts: int = Field(ge=1, le=10)
    details: dict[str, str | int | bool] = Field(default_factory=dict)


def _status(exc: Exception) -> int | None:
    value = getattr(exc, "status", None)
    if isinstance(value, int):
        return value
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code
    return None


def _classification(exc: Exception) -> tuple[FailureCategory, str, bool]:
    status = _status(exc)
    if isinstance(exc, AgentContractError):
        return FailureCategory.PROTOCOL, exc.code, False
    if isinstance(exc, ConnectionAuthorizationError):
        return FailureCategory.AUTHORIZATION, "platform_connection_unavailable", False
    if isinstance(exc, EffectClaimInProgress):
        return FailureCategory.DEPENDENCY, "effect_claim_in_progress", True
    if isinstance(exc, EffectClaimUncertain):
        return FailureCategory.POLICY, "effect_outcome_uncertain", False
    if isinstance(exc, ValidationError) or isinstance(exc, (ValueError, KeyError, IngestError)):
        if isinstance(exc, UnknownModelPrice):
            return FailureCategory.BUDGET, "unknown_model_price", False
        return FailureCategory.VALIDATION, "contract_validation_failed", False
    if isinstance(exc, (AgentProtocolError, AgentEngineProtocolError, MediaProtocolError, MemoryProtocolError)):
        return FailureCategory.PROTOCOL, "invalid_provider_response", False
    if isinstance(exc, (WebApiError, XError)):
        if status in (401, 403):
            return FailureCategory.AUTHORIZATION, "service_authorization_failed", False
        if isinstance(exc, WebApiError) and status in (400, 422):
            return FailureCategory.VALIDATION, "internal_contract_rejected", False
        if getattr(exc, "permanent", False):
            return FailureCategory.PROVIDER_PERMANENT, "provider_request_rejected", False
        return FailureCategory.PROVIDER_TRANSIENT, "provider_request_failed", True
    if isinstance(exc, MediaProviderError):
        if exc.permanent:
            return FailureCategory.PROVIDER_PERMANENT, "provider_request_rejected", False
        return FailureCategory.PROVIDER_TRANSIENT, "provider_request_failed", True
    if isinstance(exc, httpx.TimeoutException):
        return FailureCategory.PROVIDER_TRANSIENT, "provider_timeout", True
    if isinstance(exc, httpx.HTTPError):
        if status is not None and status < 500 and status != 429:
            return FailureCategory.PROVIDER_PERMANENT, "provider_request_rejected", False
        return FailureCategory.PROVIDER_TRANSIENT, "provider_transport_failed", True
    if isinstance(exc, AgentEngineProviderError) and status is not None:
        if status == 429 or status >= 500:
            return FailureCategory.PROVIDER_TRANSIENT, "provider_request_failed", True
        if status in (401, 403):
            return FailureCategory.AUTHORIZATION, "service_authorization_failed", False
        return FailureCategory.PROVIDER_PERMANENT, "provider_request_rejected", False
    if isinstance(exc, (AgentEngineProviderError, MemoryProviderError)):
        return FailureCategory.DEPENDENCY, "managed_dependency_unavailable", True
    return FailureCategory.DEPENDENCY, "unexpected_dependency_failure", True


def normalize_failure(
    exc: Exception,
    *,
    stage: str,
    operation_id: str,
    trace_id: str,
    attempt: int,
    max_attempts: int = MAX_STAGE_ATTEMPTS,
    category: FailureCategory | None = None,
    code: str | None = None,
    details: dict[str, Any] | None = None,
) -> FailureEnvelope:
    inferred_category, inferred_code, retryable = _classification(exc)
    resolved_category = category or inferred_category
    if category is not None:
        retryable = category in {
            FailureCategory.PROVIDER_TRANSIENT,
            FailureCategory.DEPENDENCY,
        }
    effective_retryable = retryable and attempt + 1 < max_attempts
    safe_details: dict[str, str | int | bool] = {"exceptionType": type(exc).__name__}
    if isinstance(exc, AgentContractError):
        safe_details["role"] = exc.role
        if exc.path:
            safe_details["path"] = exc.path
    if isinstance(exc, WebApiError):
        for key, value in exc.details.items():
            normalized = key.lower().replace("-", "_")
            if any(forbidden in normalized for forbidden in ("body", "content", "cookie", "prompt", "response", "secret", "text", "token", "transcript")):
                continue
            if isinstance(value, (str, int, bool)):
                safe_details[key] = value
    status = _status(exc)
    if status is not None:
        safe_details["status"] = status
    for key, value in (details or {}).items():
        normalized = key.lower().replace("-", "_")
        if any(forbidden in normalized for forbidden in ("body", "content", "cookie", "prompt", "response", "secret", "text", "token", "transcript")):
            continue
        if isinstance(value, (str, int, bool)):
            safe_details[key] = value
    public_message = (
        exc.public_message if isinstance(exc, AgentContractError)
        else PUBLIC_MESSAGES[resolved_category]
    )
    return FailureEnvelope(
        category=resolved_category,
        code=code or inferred_code,
        public_message=public_message,
        retryable=effective_retryable,
        stage=stage,
        operation_id=operation_id,
        trace_id=trace_id,
        attempt=attempt,
        max_attempts=max_attempts,
        details=safe_details,
    )
