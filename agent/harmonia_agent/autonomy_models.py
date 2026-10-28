"""Strict persisted cognitive outputs for governed resident autonomy."""

from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class ReflectionOutput(StrictModel):
    id: str = Field(min_length=1, max_length=300)
    evidence_refs: list[str] = Field(min_length=1, max_length=500)
    scope: str = Field(min_length=1, max_length=200)
    summary: str = Field(min_length=1, max_length=4000)
    confidence: float = Field(ge=0, le=1)
    expires_at: datetime
    expected_benefit: str = Field(max_length=1000)
    risk_class: Literal["low", "medium", "high"]
    estimated_cost_usd: float = Field(ge=0)
    evaluation_criteria: str = Field(max_length=2000)


class HypothesisOutput(StrictModel):
    id: str = Field(min_length=1, max_length=300)
    reflection_id: str = Field(min_length=1, max_length=300)
    evidence_refs: list[str] = Field(min_length=1, max_length=500)
    statement: str = Field(min_length=1, max_length=2000)
    confidence: float = Field(ge=0, le=1)
    expires_at: datetime
    contradiction_refs: list[str] = Field(max_length=500)


class ExperimentOutput(StrictModel):
    id: str = Field(min_length=1, max_length=300)
    hypothesis_id: str = Field(min_length=1, max_length=300)
    variable: Literal["preferred_posting_hour", "content_format_weight", "topic_fatigue_threshold", "retry_backoff_seconds", "approved_template_preference"]
    baseline: str | int | float | bool
    candidate: str | int | float | bool
    lower_bound: float | None = None
    upper_bound: float | None = None
    evidence_threshold: int = Field(gt=0)
    evaluation_method: Literal["holdout", "before_after"]
    success_criteria: str = Field(min_length=1, max_length=2000)
    failure_criteria: str = Field(min_length=1, max_length=2000)
    maximum_cost_usd: float = Field(ge=0)
    starts_at: datetime
    ends_at: datetime
    expires_at: datetime
    rollback_condition: str = Field(min_length=1, max_length=2000)


class DreamCycleOutput(StrictModel):
    reflections: list[ReflectionOutput] = Field(max_length=100)
    hypotheses: list[HypothesisOutput] = Field(max_length=100)
    experiments: list[ExperimentOutput] = Field(max_length=50)
    safe_activity_summary: str = Field(min_length=1, max_length=2000)


class EligibleObservationInput(StrictModel):
    id: str = Field(min_length=1, max_length=300)
    observation_type: str = Field(min_length=1, max_length=100)
    facts: dict[str, str | int | float | bool | None]


class DreamCycleInput(StrictModel):
    cycle_id: str = Field(min_length=1, max_length=300)
    observations: list[EligibleObservationInput] = Field(min_length=1, max_length=500)
