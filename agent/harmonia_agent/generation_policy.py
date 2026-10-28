"""Translate Harmonia's role policy into the ADK request configuration."""

from __future__ import annotations

from google.genai import types

from .role_models import RoleModelConfig


def generation_config(role: RoleModelConfig) -> types.GenerateContentConfig:
    """Build the concrete request configuration for a cognitive role.

    Sampling stays at Muse Spark's tuned defaults; reasoning effort travels on
    the role's model binding. ADK's LiteLLM adapter maps the output budget to
    ``max_completion_tokens`` and the HTTP options to timeout and retries.
    """
    if role.generation.safety_profile != "harmonia-standard":
        raise ValueError(f"unknown safety profile: {role.generation.safety_profile}")
    return types.GenerateContentConfig(
        max_output_tokens=role.max_output_tokens,
        http_options=types.HttpOptions(
            timeout=role.timeout_seconds * 1_000,
            retry_options=types.HttpRetryOptions(attempts=2),
        ),
    )
