import asyncio

import httpx
from pydantic import BaseModel, ValidationError

from harmonia_agent.agents import AgentProtocolError
from harmonia_agent.failures import FailureCategory, normalize_failure
from harmonia_agent.generative_media import MediaProviderError
from harmonia_agent.memory_bank import MemoryProviderError
from harmonia_agent.model_catalog import UnknownModelPrice
from harmonia_agent.team_runtime import AgentEngineProviderError
from harmonia_agent.web_client import (
    ConnectionAuthorizationError,
    EffectClaimInProgress,
    EffectClaimUncertain,
    WebApiError,
    _response_error,
)
from harmonia_agent.x_client import XError
from harmonia_agent import stages


def envelope(exc: Exception, *, attempt: int = 0):
    return normalize_failure(
        exc,
        stage="draft",
        operation_id="job-1:draft:0",
        trace_id="a" * 32,
        attempt=attempt,
    )


def test_normalizes_every_required_failure_category():
    class Required(BaseModel):
        value: int

    try:
        Required.model_validate({"value": "not-an-int"})
    except ValidationError as exc:
        validation = exc

    request = httpx.Request("GET", "https://provider.example")
    cases = [
        (validation, FailureCategory.VALIDATION),
        (WebApiError("Bearer super-secret", 401), FailureCategory.AUTHORIZATION),
        (MediaProviderError("filtered content", permanent=True), FailureCategory.PROVIDER_PERMANENT),
        (UnknownModelPrice("model with no price"), FailureCategory.BUDGET),
        (httpx.ConnectTimeout("token=super-secret", request=request), FailureCategory.PROVIDER_TRANSIENT),
        (XError("provider body super-secret", 400), FailureCategory.PROVIDER_PERMANENT),
        (MemoryProviderError("backend unavailable"), FailureCategory.DEPENDENCY),
        (AgentProtocolError("raw model output super-secret"), FailureCategory.PROTOCOL),
    ]

    for exc, expected in cases:
        result = envelope(exc)
        assert result.category == expected
        assert result.stage == "draft"
        assert result.operation_id == "job-1:draft:0"
        assert result.trace_id == "a" * 32
        assert "super-secret" not in result.model_dump_json()


def test_policy_failure_is_explicit_and_never_retryable():
    result = normalize_failure(
        PermissionError("operator approval required"),
        stage="publish",
        operation_id="job-1:publish:0",
        trace_id="b" * 32,
        attempt=0,
        category=FailureCategory.POLICY,
        code="approval_required",
    )
    assert result.category == FailureCategory.POLICY
    assert result.retryable is False
    assert result.public_message == "Operator or policy action is required before this stage can continue."


def test_internal_contract_rejection_is_not_reported_as_a_provider_failure():
    result = envelope(WebApiError(
        "invalid payload with private details", 400,
        details={
            "endpoint": "/api/internal/strategy-context",
            "path": "sourceIds",
            "issueCode": "too_big",
            "maximum": 24,
            "contractRevision": "internal-contract-2026-09-04",
        },
    ))
    assert result.category == FailureCategory.VALIDATION
    assert result.code == "internal_contract_rejected"
    assert result.retryable is False
    assert result.details["endpoint"] == "/api/internal/strategy-context"
    assert result.details["path"] == "sourceIds"
    assert result.details["issueCode"] == "too_big"
    assert "private details" not in result.model_dump_json()


def test_missing_platform_connection_is_an_authorization_failure():
    result = normalize_failure(
        ConnectionAuthorizationError("linkedin", 400),
        stage="publish",
        operation_id="job:1:stage:publish:generation:2",
        trace_id="a" * 32,
        attempt=0,
    )

    assert result.category == FailureCategory.AUTHORIZATION
    assert result.code == "platform_connection_unavailable"
    assert result.retryable is False
    assert result.details["platform"] == "linkedin"


def test_internal_contract_response_extracts_only_safe_diagnostics():
    response = httpx.Response(
        400,
        request=httpx.Request("POST", "https://useharmonia.xyz/api/internal/strategy-context"),
        json={
            "error": "invalid payload",
            "contractRevision": "internal-contract-2026-09-04.1",
            "issues": [{
                "path": "sourceIds",
                "code": "too_big",
                "maximum": 24,
                "privateInput": "private-source-content",
            }],
        },
    )

    error = _response_error("/api/internal/strategy-context", response)
    assert error.details == {
        "endpoint": "/api/internal/strategy-context",
        "contractRevision": "internal-contract-2026-09-04.1",
        "path": "sourceIds",
        "issueCode": "too_big",
        "maximum": 24,
    }
    assert "private-source-content" not in str(error)


def test_effect_claim_contention_retries_but_uncertain_effect_requires_operator():
    in_progress = envelope(EffectClaimInProgress("another worker owns the claim"))
    assert in_progress.category == FailureCategory.DEPENDENCY
    assert in_progress.code == "effect_claim_in_progress"
    assert in_progress.retryable is True

    uncertain = envelope(EffectClaimUncertain("provider outcome is unknown"))
    assert uncertain.category == FailureCategory.POLICY
    assert uncertain.code == "effect_outcome_uncertain"
    assert uncertain.retryable is False


def test_retryable_failures_stop_after_the_central_attempt_limit():
    request = httpx.Request("GET", "https://provider.example")
    exc = httpx.ReadTimeout("temporary", request=request)
    assert envelope(exc, attempt=0).retryable is True
    exhausted = envelope(exc, attempt=2)
    assert exhausted.retryable is False
    assert exhausted.max_attempts == 3
    assert exhausted.code == "provider_timeout"


def test_agent_engine_quota_exhaustion_is_a_transient_provider_failure():
    result = envelope(AgentEngineProviderError("quota exhausted", status=429))
    assert result.category == FailureCategory.PROVIDER_TRANSIENT
    assert result.code == "provider_request_failed"
    assert result.retryable is True
    assert result.details["status"] == 429


def test_unknown_exception_is_safe_bounded_dependency_failure():
    result = envelope(RuntimeError("cookie=super-secret and private response body"))
    assert result.category == FailureCategory.DEPENDENCY
    assert result.retryable is True
    assert result.public_message == "A required dependency is temporarily unavailable."
    assert result.details == {"exceptionType": "RuntimeError"}


def test_dispatch_reports_typed_failure_and_quarantines_ambiguous_retry(monkeypatch):
    reports = []
    finalized = []

    async def fail(_job_id):
        raise httpx.ReadTimeout("token=super-secret", request=httpx.Request("GET", "https://provider.example"))

    monkeypatch.setitem(stages.HANDLERS, "draft", fail)
    monkeypatch.setattr(stages, "get_job", lambda _job_id: {"controlState": "running"})
    monkeypatch.setattr(stages, "web_post", lambda path, body: reports.append((path, body)))
    monkeypatch.setattr(stages, "claim_stage_execution", lambda _payload: {"outcome": "execute"})
    monkeypatch.setattr(stages, "finalize_stage_execution", finalized.append)

    operation_id = "job:job-1:stage:draft:generation:0"
    assert asyncio.run(stages.dispatch("job-1", "draft", attempt=0, operation_id=operation_id)) == "failed"
    first = reports[-1][1]
    assert first["category"] == "provider_transient"
    assert first["retryable"] is True
    assert first["operationId"] == operation_id
    assert "super-secret" not in str(first)
    assert finalized[-1]["outcome"] == "uncertain"

    assert asyncio.run(stages.dispatch("job-1", "draft", attempt=2, operation_id=operation_id)) == "failed"
    assert reports[-1][1]["retryable"] is False
    assert finalized[-1]["outcome"] == "failed"


def test_dispatch_does_not_enter_handler_without_stage_lease(monkeypatch):
    entered: list[str] = []

    async def handler(job_id):
        entered.append(job_id)

    monkeypatch.setitem(stages.HANDLERS, "draft", handler)
    monkeypatch.setattr(stages, "get_job", lambda _job_id: {"controlState": "running"})
    monkeypatch.setattr(stages, "claim_stage_execution", lambda _payload: {"outcome": "in_progress"})

    assert asyncio.run(stages.dispatch("job-1", "draft", attempt=0)) is True
    assert entered == []


def test_dispatch_surfaces_uncertain_stage_lease_for_fresh_generation_retry(monkeypatch):
    reports = []
    entered: list[str] = []

    async def handler(job_id):
        entered.append(job_id)

    monkeypatch.setitem(stages.HANDLERS, "draft", handler)
    monkeypatch.setattr(stages, "get_job", lambda _job_id: {"controlState": "running"})
    monkeypatch.setattr(stages, "claim_stage_execution", lambda _payload: {"outcome": "uncertain"})
    monkeypatch.setattr(stages, "web_post", lambda path, body: reports.append((path, body)))

    operation_id = "job:job-1:stage:draft:generation:2"
    assert asyncio.run(stages.dispatch("job-1", "draft", attempt=0, operation_id=operation_id)) == "failed"
    assert entered == []
    assert reports[-1][0] == "/api/internal/failure"
    assert reports[-1][1]["code"] == "stage_execution_uncertain"
    assert reports[-1][1]["retryable"] is True
    assert reports[-1][1]["operationId"] == operation_id


def test_dispatch_records_generation_fenced_missing_handler(monkeypatch):
    reports = []
    operation_id = "job:job-1:stage:obsolete:generation:7"
    monkeypatch.setattr(stages, "get_job", lambda _job_id: {"controlState": "running"})
    monkeypatch.setattr(stages, "web_post", lambda path, body: reports.append((path, body)))

    assert asyncio.run(stages.dispatch("job-1", "obsolete", attempt=7, operation_id=operation_id)) == "failed"
    assert reports[-1][0] == "/api/internal/failure"
    assert reports[-1][1]["code"] == "missing_stage_handler"
    assert reports[-1][1]["operationId"] == operation_id


def test_dispatch_finalizes_the_exact_stage_claim(monkeypatch):
    finalized: list[dict] = []

    async def handler(_job_id):
        return None

    monkeypatch.setitem(stages.HANDLERS, "draft", handler)
    monkeypatch.setattr(stages, "get_job", lambda _job_id: {"controlState": "running"})
    monkeypatch.setattr(stages, "claim_stage_execution", lambda _payload: {"outcome": "execute"})
    monkeypatch.setattr(stages, "finalize_stage_execution", finalized.append)

    assert asyncio.run(stages.dispatch("job-1", "draft", attempt=0)) is True
    assert finalized[0]["outcome"] == "applied"
    assert finalized[0]["claimToken"]


def test_dispatch_scopes_model_operations_to_the_current_stage_generation(monkeypatch):
    seen: list[str] = []

    async def handler(_job_id):
        seen.append(stages._invocation_operation_id("legacy-operation", "source-1"))

    operation_id = "job:job-1:stage:extract_sources:generation:2"
    monkeypatch.setitem(stages.HANDLERS, "extract_sources", handler)
    monkeypatch.setattr(stages, "get_job", lambda _job_id: {"controlState": "running"})
    monkeypatch.setattr(stages, "claim_stage_execution", lambda _payload: {"outcome": "execute"})
    monkeypatch.setattr(stages, "finalize_stage_execution", lambda _payload: None)

    assert asyncio.run(stages.dispatch("job-1", "extract_sources", operation_id=operation_id)) is True
    assert seen == [f"{operation_id}:source-1"]
