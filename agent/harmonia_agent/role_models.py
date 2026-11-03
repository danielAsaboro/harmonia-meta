"""Strict, versioned model assignments for every Harmonia cognitive role."""

from __future__ import annotations

import os
from decimal import Decimal, InvalidOperation
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .model_catalog import PRICING_VERSION

POLICY_VERSION = "gear-2026-11-03"


ReasoningEffort = Literal["minimal", "low", "medium", "high", "xhigh"]


class RoleGenerationPolicy(BaseModel):
    """Reasoning depth and safety profile for one cognitive role.

    Muse Spark is tuned for its default sampling, so roles steer it with
    ``reasoning_effort`` instead of temperature (docs/meta-model-api/reasoning.md).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    reasoning_effort: ReasoningEffort
    safety_profile: Literal["harmonia-standard"] = "harmonia-standard"


class RoleModelConfig(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    role: str
    provider: Literal["meta", "baseten"]
    model_id: str
    max_output_tokens: int
    generation: RoleGenerationPolicy = Field(
        default_factory=lambda: RoleGenerationPolicy(reasoning_effort="medium"),
    )
    policy_version: str = POLICY_VERSION
    pricing_version: str = PRICING_VERSION
    timeout_seconds: int = Field(default=120, gt=0, le=600)
    eligible_tasks: tuple[str, ...] = ("*",)
    minimum_pass_rate: Decimal = Field(default=Decimal("0.95"), ge=0, le=1)
    reservation_usd: str | None = None

    @model_validator(mode="after")
    def validate_provider_configuration(self) -> "RoleModelConfig":
        if self.reservation_usd is not None:
            try:
                value = Decimal(self.reservation_usd)
            except InvalidOperation as exc:
                raise ValueError(f"{self.role} reservation must be a decimal") from exc
            if value <= 0:
                raise ValueError(f"{self.role} reservation must be positive")
            object.__setattr__(self, "reservation_usd", f"{value:.6f}")
        return self

    def policy_snapshot(self) -> dict[str, Any]:
        """Return the exact immutable policy fields recorded with an invocation."""
        return {
            "policyVersion": self.policy_version,
            "pricingVersion": self.pricing_version,
            "provider": self.provider,
            "reasoningEffort": self.generation.reasoning_effort,
            "safetyProfile": self.generation.safety_profile,
            "maxOutputTokens": self.max_output_tokens,
            "timeoutSeconds": self.timeout_seconds,
            "eligibleTasks": list(self.eligible_tasks),
            "minimumPassRate": str(self.minimum_pass_rate),
        }


class RoleModelCatalog(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    coordinator: RoleModelConfig
    strategist: RoleModelConfig
    analyst: RoleModelConfig
    copywriter: RoleModelConfig
    editor: RoleModelConfig
    planner: RoleModelConfig
    presenter: RoleModelConfig
    liaison: RoleModelConfig

    def roles(self) -> tuple[RoleModelConfig, ...]:
        return (
            self.coordinator,
            self.strategist,
            self.analyst,
            self.copywriter,
            self.editor,
            self.planner,
            self.presenter,
            self.liaison,
        )

    def model_for(self, role: str) -> RoleModelConfig:
        for item in self.roles():
            if item.role == role:
                return item
        raise KeyError(f"unknown agent role: {role}")


def _policy(reasoning_effort: ReasoningEffort) -> RoleGenerationPolicy:
    return RoleGenerationPolicy(reasoning_effort=reasoning_effort)


DEFAULT_META_MODEL = "muse-spark-1.3"
# Ryan plans a month of content in one long, high-effort pass: Meta's guidance
# puts long-horizon agentic work on Muse Wonder and high-volume roles on Spark.
STRATEGIST_META_MODEL = "muse-wonder-1.0"
BASETEN_OPEN_MODEL = "meta-models/muse-spark-open-1026"


def _role(
    role: str,
    env_name: str,
    default: str,
    max_output_tokens: int,
    reasoning_effort: ReasoningEffort,
    eligible_tasks: tuple[str, ...],
    timeout_seconds: int = 120,
) -> RoleModelConfig:
    prefix = env_name.removesuffix("MODEL_ID")
    provider = os.environ.get(prefix + "PROVIDER", "meta")
    if provider not in {"meta", "baseten"}:
        raise ValueError(f"{prefix}PROVIDER must be meta or baseten")
    fallback = BASETEN_OPEN_MODEL if provider == "baseten" else default
    return RoleModelConfig(
        role=role,
        provider=provider,
        model_id=os.environ.get(env_name, fallback),
        max_output_tokens=max_output_tokens,
        timeout_seconds=int(os.environ.get(prefix + "TIMEOUT_SECONDS", str(timeout_seconds))),
        generation=_policy(reasoning_effort),
        eligible_tasks=eligible_tasks,
    )


def load_role_model_catalog() -> RoleModelCatalog:
    return RoleModelCatalog(
        coordinator=_role(
            "harmonia_coordinator", "COORDINATOR_MODEL_ID", DEFAULT_META_MODEL, 4096, "low",
            ("route",),
        ),
        strategist=_role(
            "ryan_strategist", "STRATEGIST_MODEL_ID", STRATEGIST_META_MODEL, 32768, "high",
            ("strategize",), 300,
        ),
        analyst=_role(
            "nimi_analyst", "ANALYST_MODEL_ID", DEFAULT_META_MODEL, 16384, "medium",
            ("analyze_media", "analyze_sources"),
        ),
        copywriter=_role(
            "noni_copywriter", "COPYWRITER_MODEL_ID", DEFAULT_META_MODEL, 8192, "medium",
            ("draft_or_revise_x",),
        ),
        editor=_role(
            "dara_editor", "EDITOR_MODEL_ID", DEFAULT_META_MODEL, 8192, "medium",
            ("review_drafts",),
        ),
        planner=_role(
            "temi_editorial_planner", "PLANNER_MODEL_ID", DEFAULT_META_MODEL, 16384, "medium",
            ("propose_editorial_plan",),
        ),
        presenter=_role(
            "maya_presenter", "PRESENTER_MODEL_ID", DEFAULT_META_MODEL, 8192, "low",
            ("compose_surface",),
        ),
        liaison=_role(
            "nova_liaison", "LIAISON_MODEL_ID", DEFAULT_META_MODEL, 8192, "low",
            ("answer_status", "answer_insights"),
        ),
    )
