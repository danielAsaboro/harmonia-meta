"""Ryan's filesystem strategy skill and deterministic resource boundary."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.adk.tools import skill_toolset

from harmonia_agent.ryan_skills import (
    RYAN_SKILL_NAME,
    RYAN_SKILL_REFERENCES,
    build_ryan_strategy_skillset,
    build_ryan_web_search_tool,
    bootstrap_ryan_skill_trace,
    guard_ryan_skill_tool,
    reset_ryan_skill_trace,
    validate_ryan_skill_trace,
)
from harmonia_agent.agents import _validate_run_output, build_agent_team
from harmonia_agent.agent_errors import AgentContractError
from harmonia_agent.ryan_prompt import RYAN_STRATEGIST_INSTRUCTION
from harmonia_agent.meta_search import MetaWebSearchTool
from tests.test_ryan_strategy import strategist_input, strategy
from tests.web_search_fixtures import search_tool_response


def _trace(*resources: str) -> list[dict]:
    calls = [{
        "sequence": 1,
        "name": "load_skill",
        "args": {"skill_name": RYAN_SKILL_NAME},
    }]
    calls.extend({
        "sequence": index,
        "name": "load_skill_resource",
        "args": {"skill_name": RYAN_SKILL_NAME, "file_path": resource},
    } for index, resource in enumerate(resources, start=2))
    return calls


def test_ryan_skillset_exposes_only_skill_and_resource_loaders():
    toolset = build_ryan_strategy_skillset()

    assert isinstance(toolset, skill_toolset.SkillToolset)
    assert [skill.frontmatter.name for skill in toolset.skills] == [RYAN_SKILL_NAME]
    assert {tool.name for tool in asyncio.run(toolset.get_tools())} == {
        "load_skill", "load_skill_resource",
    }


def test_ryan_reference_allow_list_is_small_complete_and_loadable():
    assert RYAN_SKILL_REFERENCES == (
        "references/strategic-diagnosis.md",
        "references/positioning-and-thesis.md",
        "references/campaign-and-portfolio.md",
        "references/channels-formats-and-cadence.md",
        "references/funnel-cta-and-measurement.md",
        "references/source-grounded-briefs.md",
        "references/evidence-learning-and-revision.md",
    )
    assert validate_ryan_skill_trace(_trace(RYAN_SKILL_REFERENCES[0])) == {}


@pytest.mark.parametrize(("calls", "message"), [
    ([], "exactly once first"),
    (_trace(), "at least one strategy reference"),
    (_trace("references/source-coverage.md"), "unapproved resource"),
    (_trace("references/strategic-diagnosis.md", "references/strategic-diagnosis.md"), "duplicate"),
])
def test_ryan_trace_rejects_missing_unapproved_and_duplicate_resources(calls, message):
    with pytest.raises(ValueError, match=message):
        validate_ryan_skill_trace(calls)


def test_ryan_trace_rejects_wrong_skill_invalid_order_and_other_tools():
    wrong = _trace(RYAN_SKILL_REFERENCES[0])
    wrong[0]["args"]["skill_name"] = "noni-writing-skills"
    with pytest.raises(ValueError, match="only ryan-strategy-skills"):
        validate_ryan_skill_trace(wrong)

    unordered = _trace(RYAN_SKILL_REFERENCES[0])
    unordered[1]["sequence"] = 3
    with pytest.raises(ValueError, match="sequence"):
        validate_ryan_skill_trace(unordered)

    prohibited = _trace(RYAN_SKILL_REFERENCES[0])
    prohibited.append({"sequence": 3, "name": "google_search", "args": {}})
    with pytest.raises(ValueError, match="prohibited tool"):
        validate_ryan_skill_trace(prohibited)


def test_guard_blocks_unapproved_resource_before_adk_loads_it():
    tool = SimpleNamespace(name="load_skill_resource")
    with pytest.raises(ValueError, match="unapproved resource"):
        guard_ryan_skill_tool(
            tool,
            {"skill_name": RYAN_SKILL_NAME, "file_path": "references/source-coverage.md"},
            SimpleNamespace(),
        )


def test_source_coverage_ledger_accounts_for_every_supplied_source():
    ledger = (Path(__file__).parents[1] / "harmonia_agent/skills/ryan-strategy-skills/references/source-coverage.md").read_text()
    urls = [
        "opinionated-content", "auteur-theory", "you-need-a-nemesis",
        "talk-about-your-competitors", "second-mover-advantage", "write-for-the-lurkers",
        "low-effort-high-impact", "coined-concepts", "content-maturity-model",
        "youre-a-content-marketer-not-a-writer", "content-arbitrage", "second-order-pain-points",
        "information-gain-2022", "mental-models", "horizontal-saas-content-marketing",
        "twitter-for-thought-leadership", "the-quality-cliff", "explore-v-exploit",
        "the-growth-wave", "good-content", "bottom-of-the-funnel-content",
        "top-of-funnel-content", "library-vs-publication-2024-update", "templates-and-cross-cutting",
        "content-creation-lanes", "diversified-content-portfolio", "content-marketing-in-a-crisis",
    ]
    assert all(ledger.count(f"https://www.animalz.co/blog/{slug}") == 1 for slug in urls)
    assert ledger.count("| Partial |") == len(urls)
    assert ledger.count("https://dev.meta.ai/docs/search-grounding") == 1


def test_ryan_runtime_is_wired_to_bounded_skill_callbacks():
    team = build_agent_team(model="muse-test")
    ryan = next(agent for agent in team.sub_agents if agent.name == "ryan_strategist")
    assert ryan.tools == []
    research = next(agent for agent in team.sub_agents if agent.name == "ryan_research_strategist")
    assert len(research.tools) == 1
    assert isinstance(research.tools[0], MetaWebSearchTool)
    assert research.tools[0].name == "ryan_web_search"
    assert ryan.before_agent_callback is bootstrap_ryan_skill_trace
    assert ryan.before_tool_callback is guard_ryan_skill_tool
    assert ryan.after_tool_callback.__name__ == "record_ryan_skill_tool"


def test_search_guard_requires_exact_host_authority_before_execution():
    tool = SimpleNamespace(name="ryan_web_search")
    request = {"id": "research-1", "question": "What current primary evidence is available?", "justification": "Current external evidence is required."}
    with pytest.raises(ValueError, match="authorized research request"):
        guard_ryan_skill_tool(tool, {"request": json.dumps(request)}, SimpleNamespace(state={}))
    context = SimpleNamespace(state={"researchRequest": request})
    with pytest.raises(ValueError, match="exact"):
        guard_ryan_skill_tool(tool, {"request": json.dumps({**request, "id": "invented"})}, context)
    guard_ryan_skill_tool(tool, {"request": json.dumps(request)}, context)
    # A second dispatch must fail even before the first after-tool callback.
    with pytest.raises(ValueError, match="once"):
        guard_ryan_skill_tool(tool, {"request": json.dumps(request)}, context)


def test_ryan_prompt_names_current_strict_strategy_fields():
    """Catches skill vocabulary overriding the current Pydantic output contract."""

    for field in (
        "strategyId", "differentiatedNarrative", "objectives", "funnelIntent",
        "channelCandidates", "formatCandidates", "ctaIntent", "intendedConversion",
        "evidenceRefs",
    ):
        assert field in RYAN_STRATEGIST_INSTRUCTION
    assert "priority values are integers from 1 through 5" in RYAN_STRATEGIST_INSTRUCTION
    assert "Do not use legacy brief keys" in RYAN_STRATEGIST_INSTRUCTION
    assert "runtime has already loaded" in RYAN_STRATEGIST_INSTRUCTION
    assert "call load_skill" not in RYAN_STRATEGIST_INSTRUCTION
    assert "exactly one item in every required list" in RYAN_STRATEGIST_INSTRUCTION
    assert 'confidence values are only the strings "low", "medium", or "high"' in RYAN_STRATEGIST_INSTRUCTION


def test_preloaded_strategy_skill_does_not_request_unavailable_loaders():
    skill = (Path(__file__).parents[1] / "harmonia_agent/skills/ryan-strategy-skills/SKILL.md").read_text()
    assert "preloads this skill" in skill
    assert "Load this skill exactly once" not in skill


def test_ryan_runtime_rejects_missing_trace_and_accepts_valid_actual_trace():
    state = {"strategist_result": {"strategy": strategy().model_dump(mode="json")}}
    with pytest.raises(AgentContractError) as exc:
        _validate_run_output("ryan_strategist", strategist_input(), state)
    assert "strategy-skill trace" in str(exc.value.__cause__)

    state["ryan_strategy_skill_trace"] = _trace(RYAN_SKILL_REFERENCES[0])
    _validate_run_output("ryan_strategist", strategist_input(), state)


def test_ryan_web_search_runs_on_the_role_model_in_its_own_request():
    tool = build_ryan_web_search_tool("muse-test")
    assert isinstance(tool, MetaWebSearchTool)
    assert tool.name == "ryan_web_search"
    assert tool.model_id == "muse-test"


def test_ryan_search_trace_requires_exact_request_and_web_search_provenance():
    request = {"id": "research-current-market", "question": "What current public evidence describes governed content operations?", "justification": "Current external information is necessary."}
    research = {"requestId": request["id"], "query": request["question"], "sources": [{
        "evidenceId": "search-1", "title": "Search grounding", "url": "https://dev.meta.ai/docs/search-grounding", "supportedText": "Grounding connects model output to verifiable sources."
    }]}
    calls = _trace(RYAN_SKILL_REFERENCES[0])
    calls.append({"sequence": 3, "name": "ryan_web_search", "args": {"request": json.dumps(request, sort_keys=True)}, "response": search_tool_response(research)})
    evidence = validate_ryan_skill_trace(calls, research_request=request)
    assert evidence["search-1"][2] == research["sources"][0]["url"]

    calls[-1]["response"]["research"]["requestId"] = "research-other"
    with pytest.raises(ValueError, match="exact strategy research request"):
        validate_ryan_skill_trace(calls, research_request=request)

    calls[-1]["response"]["research"]["requestId"] = request["id"]
    calls[-1]["response"]["research"]["query"] = "celebrity fashion gossip"
    with pytest.raises(ValueError, match="outside the strategy research request"):
        validate_ryan_skill_trace(calls, research_request=request)

    calls[-1]["response"]["research"]["query"] = request["question"]
    calls[-1]["response"]["provenance"]["results"][0]["title"] = "Another page"
    with pytest.raises(ValueError, match="absent from web search provenance"):
        validate_ryan_skill_trace(calls, research_request=request)


def test_ryan_runtime_exposes_the_recorded_search_provenance():
    request = {"id": "research-current-market", "question": "What current public evidence describes governed content operations?", "justification": "Current external information is necessary."}
    research = {"requestId": request["id"], "query": request["question"], "sources": [{
        "evidenceId": "search-1", "title": "Search grounding", "url": "https://dev.meta.ai/docs/search-grounding", "supportedText": "Grounding connects model output to verifiable sources."
    }]}
    trace = _trace(RYAN_SKILL_REFERENCES[0])
    response = search_tool_response(research)
    trace.append({"sequence": 3, "name": "ryan_web_search", "args": {"request": json.dumps(request)}, "response": response})
    state = {
        "strategist_result": {"strategy": strategy().model_dump(mode="json")},
        "ryan_strategy_skill_trace": trace,
    }
    _validate_run_output("ryan_strategist", strategist_input().model_copy(update={"researchRequest": request}), state)
    assert state["_ryan_search_evidence"]["search-1"][2] == research["sources"][0]["url"]
    assert state["_ryan_search_provenance"] == response["provenance"]
