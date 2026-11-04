"""Provider-reported tokens from each ADK model response are summed per agent."""

from __future__ import annotations

from types import SimpleNamespace

from harmonia_agent.team_runtime import _observe_usage


def _event(author, prompt, candidates, thoughts=0, cached=0):
    return SimpleNamespace(author=author, usage_metadata=SimpleNamespace(
        prompt_token_count=prompt, candidates_token_count=candidates,
        thoughts_token_count=thoughts, cached_content_token_count=cached,
    ))


def test_usage_is_summed_per_agent_and_reasoning_counts_as_output():
    totals: dict = {}
    for event in (
        _event("noni_artifact_producer", 1200, 300, thoughts=500, cached=900),
        _event("noni_artifact_producer", 1500, 80),
        _event("dara_artifact_editor", 800, 120),
        SimpleNamespace(author="noni_artifact_producer", usage_metadata=None),
        SimpleNamespace(author=None, usage_metadata=SimpleNamespace(prompt_token_count=1)),
    ):
        _observe_usage(totals, event)

    assert totals == {
        "noni_artifact_producer": {"input": 2700, "output": 880, "cached": 900, "responses": 2},
        "dara_artifact_editor": {"input": 800, "output": 120, "cached": 0, "responses": 1},
    }
