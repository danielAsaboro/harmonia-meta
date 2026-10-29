"""Provider-neutral model usage records and deterministic estimates."""

from __future__ import annotations

from datetime import datetime, timezone
from hashlib import sha256
from math import ceil
from collections.abc import Awaitable, Callable
from typing import Any, Literal, TypeVar

from pydantic import BaseModel, ConfigDict

from .model_catalog import PRICING_VERSION, estimate_text_cost


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class InvocationContext(BaseModel):
    """Durable identity shared by every model call in one stage invocation."""

    model_config = ConfigDict(extra="forbid")

    job_id: str
    workspace_id: str
    brand_id: str
    user_id: str
    stage: str
    operation_id: str

    def role_operation_id(self, role: str) -> str:
        return f"{self.operation_id}:{role}"

    def agent_engine_user_id(self) -> str:
        return f"{self.workspace_id}:{self.user_id}:{self.job_id}"


class UsageRecord(BaseModel):
    model_config = ConfigDict(
        extra="forbid", alias_generator=_to_camel, populate_by_name=True,
    )

    id: str
    job_id: str
    operation_id: str
    stage: str
    role: str
    model: str
    input_units: int
    output_units: int
    unit_type: Literal[
        "tokens", "images", "video_seconds", "audio_seconds", "endpoint_seconds",
        "media_generations",
    ] = "tokens"
    estimated_cost_usd: str
    observed_cost_usd: str | None = None
    pricing_version: str = PRICING_VERSION
    model_policy: dict[str, Any] | None = None
    trace_id: str
    created_at: str

    def to_wire(self) -> dict[str, object]:
        return self.model_dump(mode="json", by_alias=True, exclude_none=True)


ResultT = TypeVar("ResultT")


async def run_metered(
    *,
    reservation: dict[str, object],
    reserve: Callable[[dict[str, object]], None],
    invoke: Callable[[], Awaitable[tuple[ResultT, dict[str, object]]]],
    finalize: Callable[[dict[str, object]], None],
) -> ResultT:
    """Reserve before provider execution and persist usage only after it succeeds."""
    reserve(reservation)
    result, usage = await invoke()
    finalize(usage)
    return result


def estimate_request_tokens(serialized_payload: str, max_output_tokens: int) -> tuple[int, int]:
    """Return a conservative, deterministic text estimate without another model call."""
    if max_output_tokens < 0:
        raise ValueError("max_output_tokens must be non-negative")
    return ((len(serialized_payload) + 3) // 4, max_output_tokens)


def endpoint_usage_record(
    *,
    invocation: InvocationContext,
    role: str,
    model: str,
    elapsed_seconds: float,
    estimated_cost_usd: str,
    trace_id: str,
    model_policy: dict[str, Any] | None = None,
) -> UsageRecord:
    if elapsed_seconds < 0:
        raise ValueError("elapsed_seconds must be non-negative")
    operation_id = invocation.role_operation_id(role)
    return UsageRecord(
        id=f"usage-{sha256(operation_id.encode()).hexdigest()[:24]}",
        job_id=invocation.job_id,
        operation_id=operation_id,
        stage=invocation.stage,
        role=role,
        model=model,
        input_units=ceil(elapsed_seconds),
        output_units=0,
        unit_type="endpoint_seconds",
        estimated_cost_usd=estimated_cost_usd,
        trace_id=trace_id,
        model_policy=model_policy,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def media_usage_record(
    *,
    invocation: InvocationContext,
    role: str,
    model: str,
    estimated_cost_usd: str,
    trace_id: str,
) -> UsageRecord:
    return UsageRecord(
        id=f"usage-{sha256(invocation.operation_id.encode()).hexdigest()[:24]}",
        job_id=invocation.job_id,
        operation_id=invocation.operation_id,
        stage=invocation.stage,
        role=role,
        model=model,
        input_units=1,
        output_units=0,
        unit_type="media_generations",
        estimated_cost_usd=estimated_cost_usd,
        trace_id=trace_id,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


class UsageAccumulator:
    def __init__(
        self,
        *,
        job_id: str,
        operation_id: str,
        stage: str,
        role: str,
        model: str,
        model_policy: dict[str, Any] | None = None,
    ) -> None:
        self.job_id = job_id
        self.operation_id = operation_id
        self.stage = stage
        self.role = role
        self.model = model
        self.model_policy = model_policy
        self.input_tokens = 0
        self.output_tokens = 0

    def observe_event(self, event: object) -> None:
        metadata = getattr(event, "usage_metadata", None)
        if metadata is None:
            return
        self.input_tokens += int(getattr(metadata, "prompt_token_count", 0) or 0)
        self.output_tokens += int(getattr(metadata, "candidates_token_count", 0) or 0)

    def finalize(self, *, trace_id: str) -> UsageRecord:
        return UsageRecord(
            id=f"usage-{sha256(self.operation_id.encode()).hexdigest()[:24]}",
            job_id=self.job_id,
            operation_id=self.operation_id,
            stage=self.stage,
            role=self.role,
            model=self.model,
            input_units=self.input_tokens,
            output_units=self.output_tokens,
            estimated_cost_usd=str(
                estimate_text_cost(self.model, self.input_tokens, self.output_tokens)
            ),
            trace_id=trace_id,
            model_policy=self.model_policy,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
