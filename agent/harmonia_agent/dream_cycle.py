"""Budget-gated nightly synthesis over sanitized verified observations."""

from __future__ import annotations

import asyncio
import inspect
from collections.abc import Callable
from typing import Any

from google.adk.agents import Agent

from .autonomy_models import DreamCycleInput, DreamCycleOutput
from .provider_schema import meta_output_schema


def build_dream_cycle_agent(model: str) -> Agent:
    """A typed synthesis specialist with no tools or mutation capability."""
    return Agent(
        model=model,
        name="harmonia_dream_synthesizer",
        description="Synthesizes bounded hypotheses from authorized verified observations.",
        instruction=(
            "Use only the supplied sanitized observations and stable evidence identifiers. "
            "Return the DreamCycleOutput contract. Never request or reveal chain-of-thought, "
            "credentials, prompts, source content, approval capabilities, tools, or arbitrary logs. "
            "Never apply configuration changes. Propose at most one bounded variable per experiment; "
            "protected configuration remains human-reviewed. If evidence is weak, return no experiment."
        ),
        input_schema=DreamCycleInput,
        output_schema=meta_output_schema(DreamCycleOutput),
        output_key="dream_cycle_output",
        tools=[],
    )


async def run_dream_cycle(
    *, cycle_id: str, observations: list[dict[str, Any]],
    reserve_budget: Callable[[str, float], dict[str, Any]],
    synthesize: Callable[[list[dict[str, Any]]], Any],
    persist: Callable[[DreamCycleOutput], Any], estimated_cost_usd: float = 0.01,
) -> dict[str, Any]:
    if not observations:
        return {"status": "skipped", "reason": "no_new_eligible_evidence", "cycleId": cycle_id}
    reservation = await asyncio.to_thread(reserve_budget, f"{cycle_id}:synthesis", estimated_cost_usd)
    if not reservation.get("accepted"):
        return {"status": "paused", "reason": str(reservation.get("reason", "autonomy budget unavailable")), "cycleId": cycle_id}
    raw = synthesize(observations)
    if inspect.isawaitable(raw):
        raw = await raw
    output = DreamCycleOutput.model_validate(raw)
    persisted = persist(output)
    if inspect.isawaitable(persisted):
        await persisted
    return {"status": "completed", "cycleId": cycle_id, "reflectionCount": len(output.reflections), "hypothesisCount": len(output.hypotheses), "experimentCount": len(output.experiments), "safeActivitySummary": output.safe_activity_summary}
