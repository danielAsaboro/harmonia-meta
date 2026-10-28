"""Deterministic ADK root that owns specialist delegation for Harmonia."""

from __future__ import annotations

from collections.abc import AsyncGenerator

from google.adk.agents import BaseAgent
from google.adk.agents.invocation_context import InvocationContext
from google.adk.events import Event
from google.adk.utils.context_utils import Aclosing
from pydantic import ConfigDict
from typing_extensions import override


def authorized_specialist_name(requested: str, state: dict[str, object]) -> str:
    """Resolve an authority-scoped specialist without model discretion."""
    if requested == "nimi_analyst" and state.get("researchRequest") is not None:
        return "nimi_research_analyst"
    if requested == "ryan_strategist" and state.get("researchRequest") is not None:
        return "ryan_research_strategist"
    return requested


class HarmoniaCoordinator(BaseAgent):
    """Delegate one host-authorized request inside the real ADK agent tree.

    Specialist selection is already an authority-bearing workflow decision.
    The coordinator therefore reads the exact requested role from session state
    instead of spending another model call to rediscover or alter that choice.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True, extra="forbid")

    @override
    async def _run_async_impl(
        self, ctx: InvocationContext,
    ) -> AsyncGenerator[Event, None]:
        requested = ctx.session.state.get("requested_specialist")
        if not isinstance(requested, str) or not requested:
            raise ValueError("Harmonia coordinator requires requested_specialist state")
        specialist = self.find_sub_agent(
            authorized_specialist_name(requested, ctx.session.state),
        )
        if specialist is None:
            raise ValueError(f"Harmonia coordinator has no specialist named {requested}")
        if specialist is self:
            raise ValueError("Harmonia coordinator cannot delegate to itself")

        async with Aclosing(specialist.run_async(ctx)) as events:
            async for event in events:
                yield event
