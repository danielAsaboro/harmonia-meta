"""Separate contracts for Nimi's filesystem skill and grounded-research tools."""

from __future__ import annotations

import json
import asyncio
from types import SimpleNamespace

import pytest

from harmonia_agent import nimi_skills
from harmonia_agent.nimi_skills import (
    NIMI_SKILL_NAME,
    NIMI_SKILL_REFERENCES,
    build_nimi_analysis_skillset,
    guard_nimi_skill_tool,
    validate_nimi_skill_trace,
)
from harmonia_agent.meta_search import MetaWebSearchTool
from harmonia_agent.nimi_research import (
    build_nimi_web_search_tool,
    validate_nimi_research_trace,
)
from tests.web_search_fixtures import search_tool_response


def _load_trace(reference: str | None = None) -> list[dict]:
    trace = [{
        "sequence": 1, "name": "load_skill",
        "args": {"skill_name": NIMI_SKILL_NAME},
    }]
    if reference:
        trace.append({
            "sequence": 2, "name": "load_skill_resource",
            "args": {"skill_name": NIMI_SKILL_NAME, "file_path": reference},
        })
    return trace


def _public_request() -> dict:
    return {
        "id": "analysis-research-1",
        "question": "Is activation speed a current startup onboarding concern?",
        "justification": "Qualify the requested current trend angle without replacing source analysis.",
    }


def _public_response() -> dict:
    return {
        "requestId": "analysis-research-1",
        "query": "startup onboarding activation speed",
        "sources": [{
            "evidenceId": "analysis-search-1", "title": "Activation research",
            "url": "https://example.com/activation", "supportedText": "Activation speed remains a startup onboarding concern.",
        }],
    }


def test_nimi_exposes_only_one_filesystem_skill_and_approved_resources():
    tools = asyncio.run(build_nimi_analysis_skillset().get_tools())
    assert {tool.name for tool in tools} == {"load_skill", "load_skill_resource"}
    assert NIMI_SKILL_REFERENCES == (
        "references/evidence-observation-and-provenance.md",
        "references/moment-and-quote-extraction.md",
        "references/visual-and-clip-analysis.md",
        "references/themes-tensions-and-patterns.md",
        "references/angle-development.md",
        "references/performance-and-memory-interpretation.md",
        "references/uncertainty-and-analysis-critique.md",
    )


def test_nimi_runtime_bootstraps_the_owned_skill_and_approved_references():
    context = SimpleNamespace(state={})

    nimi_skills.bootstrap_nimi_skill_context(context)

    validate_nimi_skill_trace(context.state["nimi_analysis_skill_trace"])
    assert "evidence analyst" in context.state["nimi_analysis_skill_context"].lower()
    assert all(reference in str(context.state["nimi_analysis_skill_trace"]) for reference in NIMI_SKILL_REFERENCES)


def test_nimi_trace_requires_exactly_one_skill_and_one_approved_reference():
    assert validate_nimi_skill_trace(_load_trace(NIMI_SKILL_REFERENCES[0])) is None
    with pytest.raises(ValueError, match="at least one analysis reference"):
        validate_nimi_skill_trace(_load_trace())
    duplicate = _load_trace(NIMI_SKILL_REFERENCES[0])
    duplicate.append({**duplicate[-1], "sequence": 3})
    with pytest.raises(ValueError, match="duplicate"):
        validate_nimi_skill_trace(duplicate)


def test_nimi_guard_rejects_unapproved_skill_resources_and_tools():
    with pytest.raises(ValueError, match="unapproved resource"):
        guard_nimi_skill_tool(
            SimpleNamespace(name="load_skill_resource"),
            {"skill_name": NIMI_SKILL_NAME, "file_path": "references/source-coverage.md"},
        )
    with pytest.raises(ValueError, match="prohibited skill tool"):
        guard_nimi_skill_tool(SimpleNamespace(name="publish"), {})


def test_search_is_not_accepted_as_part_of_the_skill_trace():
    trace = _load_trace(NIMI_SKILL_REFERENCES[0])
    trace.append({"sequence": 3, "name": "nimi_web_search", "args": {}})
    with pytest.raises(ValueError, match="prohibited skill tool"):
        validate_nimi_skill_trace(trace)


def test_web_search_is_isolated_and_validated_against_provider_provenance():
    tool = build_nimi_web_search_tool("muse-spark-1.3")
    assert isinstance(tool, MetaWebSearchTool)
    assert tool.name == "nimi_web_search"
    assert tool.model_id == "muse-spark-1.3"
    validate_nimi_skill_trace(_load_trace(NIMI_SKILL_REFERENCES[4]))
    research_trace = [{
        "sequence": 1, "name": "nimi_web_search",
        "args": {"request": json.dumps(_public_request(), sort_keys=True)},
        "response": search_tool_response(_public_response()),
    }]
    assert validate_nimi_research_trace(
        research_trace, research_request=_public_request(),
    ) == {"analysis-search-1": (
        "Activation speed remains a startup onboarding concern.",
        "Activation research", "https://example.com/activation",
    )}


def _trace(response: dict) -> list[dict]:
    return [{
        "sequence": 1, "name": "nimi_web_search",
        "args": {"request": json.dumps(_public_request(), sort_keys=True)},
        "response": response,
    }]


def test_web_search_rejects_cross_request_and_missing_provenance():
    wrong = {**_public_request(), "id": "analysis-research-other"}
    with pytest.raises(ValueError, match="exact analysis research request"):
        validate_nimi_research_trace(_trace(search_tool_response(_public_response())), research_request=wrong)
    with pytest.raises(ValueError, match="recorded research and provenance"):
        validate_nimi_research_trace(_trace(_public_response()), research_request=_public_request())
    with pytest.raises(ValueError, match="no completed search"):
        validate_nimi_research_trace(
            _trace(search_tool_response(_public_response(), search_calls=0)),
            research_request=_public_request(),
        )


def test_web_search_rejects_sources_missing_from_provider_results():
    response = search_tool_response(_public_response())
    response["provenance"]["results"][0]["url"] = "https://example.com/other"
    with pytest.raises(ValueError, match="absent from web search provenance"):
        validate_nimi_research_trace(_trace(response), research_request=_public_request())
    response = search_tool_response(_public_response())
    response["research"]["sources"][0]["supportedText"] = "Activation speed is solved."
    with pytest.raises(ValueError, match="absent from web search provenance"):
        validate_nimi_research_trace(_trace(response), research_request=_public_request())


def test_search_is_forbidden_without_a_typed_request():
    with pytest.raises(ValueError, match="without a supplied analysis research request"):
        validate_nimi_research_trace(_trace(search_tool_response(_public_response())), research_request=None)
