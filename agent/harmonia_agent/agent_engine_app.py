"""Deployable Vertex AI Agent Engine application for Harmonia cognition."""

from __future__ import annotations

from typing import Any

from google.adk.models.base_llm import BaseLlm

from .agents import build_agent_team


def build_agent_engine_app(
    *,
    adk_app_type: type[Any] | None = None,
    model: str | BaseLlm | None = None,
) -> Any:
    if adk_app_type is None:
        from vertexai.agent_engines import AdkApp

        adk_app_type = AdkApp
    from google.adk.apps import App

    # Role models hold no credentials; MetaLlm reads MODEL_API_KEY at call time,
    # so the serialized hierarchy is safe to ship to Agent Engine.
    return adk_app_type(app=App(
        name="harmonia",
        root_agent=build_agent_team(model=model),
    ))


# Agent Engine source deployments can use entrypoint object `app`.
def __getattr__(name: str) -> Any:
    if name == "app":
        return build_agent_engine_app()
    raise AttributeError(name)
