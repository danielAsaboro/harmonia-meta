"""Runtime contract tests for callbacks registered on Harmonia's ADK agents."""

from __future__ import annotations

import inspect

import pytest

from harmonia_agent.agents import build_agent_team


_CALLBACK_ARGUMENTS = {
    "before_agent_callback": {"callback_context": object()},
    "after_agent_callback": {"callback_context": object()},
    "before_model_callback": {
        "callback_context": object(),
        "llm_request": object(),
    },
    "after_model_callback": {
        "callback_context": object(),
        "llm_response": object(),
    },
    "on_model_error_callback": {
        "callback_context": object(),
        "llm_request": object(),
        "error": RuntimeError("model failed"),
    },
    "before_tool_callback": {
        "tool": object(),
        "args": {},
        "tool_context": object(),
    },
    "after_tool_callback": {
        "tool": object(),
        "args": {},
        "tool_context": object(),
        "tool_response": {},
    },
    "on_tool_error_callback": {
        "tool": object(),
        "args": {},
        "tool_context": object(),
        "error": RuntimeError("tool failed"),
    },
}


def _registered_callbacks():
    root = build_agent_team(model="muse-test")
    for agent in (root, *root.sub_agents):
        for field, arguments in _CALLBACK_ARGUMENTS.items():
            configured = getattr(agent, field, None)
            if not configured:
                continue
            callbacks = configured if isinstance(configured, list) else [configured]
            for callback in callbacks:
                yield pytest.param(
                    callback,
                    arguments,
                    id=f"{agent.name}-{field}-{callback.__name__}",
                )


@pytest.mark.parametrize(("callback", "arguments"), list(_registered_callbacks()))
def test_registered_callbacks_accept_adk_keyword_arguments(callback, arguments):
    """Catch callbacks that ADK cannot invoke because a keyword name drifted."""
    inspect.signature(callback).bind(**arguments)
