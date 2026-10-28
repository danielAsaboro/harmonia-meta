"""Strict metadata-only records for the tenant agent-activity projection."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator


class AgentActivityRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    schemaVersion: Literal[1] = 1
    workspaceId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    brandId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    jobId: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")
    invocationId: str = Field(min_length=1, max_length=384)
    operationId: str = Field(min_length=1, max_length=384)
    occurredAt: AwareDatetime
    signalType: Literal["log", "trace", "metric"]
    eventName: str = Field(pattern=r"^[a-z][a-z0-9_.-]{1,79}$")
    severity: Literal["debug", "info", "warning", "error"]
    outcome: Literal["success", "error"]
    agent: str = Field(pattern=r"^[a-z][a-z0-9_]{1,79}$")
    stage: str = Field(pattern=r"^[a-z][a-z0-9_]{1,79}$")
    workflow: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_.-]{1,79}$")
    model: str | None = Field(default=None, min_length=1, max_length=160)
    tool: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_]{1,79}$")
    traceId: str = Field(pattern=r"^[a-f0-9]{32}$")
    spanId: str = Field(pattern=r"^[a-f0-9]{16}$")
    parentSpanId: str | None = Field(default=None, pattern=r"^[a-f0-9]{16}$")
    durationMs: int = Field(ge=0, le=86_400_000)
    inputTokens: int = Field(default=0, ge=0, le=100_000_000)
    outputTokens: int = Field(default=0, ge=0, le=100_000_000)
    inferenceCalls: int = Field(default=0, ge=0, le=10_000)
    toolCalls: int = Field(default=0, ge=0, le=10_000)
    errorCategory: Literal["authorization", "dependency", "protocol", "timeout", "internal"] | None = None
    errorType: str | None = Field(default=None, pattern=r"^[A-Za-z][A-Za-z0-9_.]{0,127}$")
    backend: Literal["google_cloud", "local"]

    @model_validator(mode="after")
    def validate_outcome(self) -> "AgentActivityRecord":
        if self.outcome == "success" and (self.errorCategory or self.errorType):
            raise ValueError("successful activity cannot contain error metadata")
        if self.outcome == "error" and not self.errorCategory:
            raise ValueError("failed activity requires a safe error category")
        if self.eventName == "tool.execution" and not self.tool:
            raise ValueError("tool activity requires a tool name")
        return self

    def to_wire(self) -> dict[str, object]:
        return self.model_dump(mode="json", exclude_none=True)
