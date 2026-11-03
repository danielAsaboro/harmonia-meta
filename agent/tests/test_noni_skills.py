"""Noni's bounded ADK writing-skill contract."""

import asyncio
from pathlib import Path

import pytest
from google.adk.tools import skill_toolset

from harmonia_agent.agents import build_agent_team
from harmonia_agent.noni_skills import (
    NONI_SKILL_NAME,
    NONI_SKILL_REFERENCES,
    build_noni_writing_skillset,
    validate_noni_skill_trace,
)
from harmonia_agent import noni_skills
from harmonia_agent.meta_search import MetaWebSearchTool
from tests.web_search_fixtures import search_tool_response


EXPECTED_REFERENCES = {
    "references/thought-leadership.md",
    "references/hooks-and-introductions.md",
    "references/structure-and-mece.md",
    "references/case-studies.md",
    "references/storytelling.md",
    "references/bad-content-diagnosis.md",
    "references/persuasion.md",
    "references/outlining.md",
    "references/titles-and-headlines.md",
    "references/convincing-content.md",
    "references/short-form-video-scripts.md",
}


def test_noni_skill_is_valid_and_covers_all_registered_writing_topics():
    toolset = build_noni_writing_skillset()

    assert isinstance(toolset, skill_toolset.SkillToolset)
    assert [skill.frontmatter.name for skill in toolset.skills] == ["noni-writing-skills"]
    assert NONI_SKILL_NAME == "noni-writing-skills"
    assert set(NONI_SKILL_REFERENCES) == EXPECTED_REFERENCES
    root = Path(__file__).parents[1] / "harmonia_agent" / "skills" / NONI_SKILL_NAME
    assert all((root / relative).read_text().strip() for relative in EXPECTED_REFERENCES)
    coverage = (root / "references" / "coverage.md").read_text()
    assert all(relative.removeprefix("references/") in coverage for relative in EXPECTED_REFERENCES)


def test_noni_skillset_exposes_loading_and_verified_publication_search_only():
    toolset = build_noni_writing_skillset()
    tools = asyncio.run(toolset.get_tools())

    assert {tool.name for tool in tools} == {"load_skill", "load_skill_resource"}
    assert set(toolset.skills[0].frontmatter.metadata["adk_additional_tools"]) == {
        "search_verified_publications",
    }


def test_noni_research_tools_have_real_read_only_contracts():
    contracts = noni_skills.validate_noni_tool_contracts()

    assert set(contracts) == {"search_verified_publications"}
    assert all(contract.permission == "read" for contract in contracts.values())
    assert all(contract.external_effect is False for contract in contracts.values())
    assert contracts["search_verified_publications"].data_scope == "workspace"


def test_verified_publication_search_returns_only_live_canonical_provenance(monkeypatch):
    monkeypatch.setattr(noni_skills.web_client, "search_verified_publications", lambda **_kwargs: {
        "publications": [{
            "publicationId": "pub-1", "platform": "x", "text": "Verified operating proof.",
            "canonicalUrl": "https://x.com/harmonia/status/123", "publishedAt": "2026-08-20T10:00:00Z",
            "receiptId": "receipt-1", "verificationId": "verification-1",
        }],
    })

    result = noni_skills.search_verified_publications("brief-1", "operating proof", 5)

    assert result["status"] == "success"
    assert result["data"]["briefId"] == "brief-1"
    assert result["data"]["publications"][0]["verificationId"] == "verification-1"
    assert result["evidence"][0]["reference"] == "https://x.com/harmonia/status/123"
    assert result["evidence"][0]["provenance"] == "live"


def test_noni_agent_receives_exactly_the_dedicated_writing_skillset():
    noni = next(agent for agent in build_agent_team().sub_agents if agent.name == "noni_copywriter")

    assert len(noni.tools) == 2
    assert isinstance(noni.tools[0], skill_toolset.SkillToolset)
    assert [skill.frontmatter.name for skill in noni.tools[0].skills] == [NONI_SKILL_NAME]
    assert isinstance(noni.tools[1], MetaWebSearchTool)
    assert noni.tools[1].name == "noni_web_search"


def _trace(*resources: str) -> list[dict]:
    calls = [{"sequence": 1, "name": "load_skill", "args": {"skill_name": NONI_SKILL_NAME}}]
    calls.extend({
        "sequence": index + 2,
        "name": "load_skill_resource",
        "args": {"skill_name": NONI_SKILL_NAME, "file_path": resource},
    } for index, resource in enumerate(resources))
    return calls


def _research_call(name: str, *, sequence: int, brief_id: str, evidence_id: str) -> dict:
    if name == "noni_web_search":
        return {
            "sequence": sequence,
            "name": name,
            "args": {"request": f"For brief {brief_id}, research agent approval workflow terminology."},
            "response": search_tool_response({
                "briefId": brief_id,
                "query": "agent approval workflow terminology",
                "sources": [{
                    "evidenceId": evidence_id,
                    "title": "Search grounding",
                    "url": "https://dev.meta.ai/docs/search-grounding",
                    "supportedText": "Ground responses with live web search.",
                }],
            }),
        }
    args = {"brief_id": brief_id, "query": "agent approval workflow", "limit": 3}
    return {
        "sequence": sequence,
        "name": name,
        "args": args,
        "response": {
            "status": "success", "data": {}, "error": None,
            "evidence": [{
                "evidenceId": evidence_id, "source": name,
                "provenance": "live", "reference": "https://example.com/source",
            }],
        },
    }


def test_noni_trace_requires_one_skill_and_at_least_one_approved_reference():
    assert validate_noni_skill_trace(_trace("references/hooks-and-introductions.md")) == {}

    with pytest.raises(ValueError, match="exactly once first"):
        validate_noni_skill_trace([])
    with pytest.raises(ValueError, match="at least one writing reference"):
        validate_noni_skill_trace(_trace())
    with pytest.raises(ValueError, match="unapproved resource"):
        validate_noni_skill_trace(_trace("references/unknown.md"))


def test_noni_trace_accepts_the_short_form_video_script_method():
    assert validate_noni_skill_trace(
        _trace("references/short-form-video-scripts.md")
    ) == {}


def test_noni_trace_allows_web_search_after_writing_reference():
    calls = _trace("references/persuasion.md")
    calls.append(_research_call(
        "search_verified_publications", sequence=3, brief_id="brief-1",
        evidence_id="ev-1111111111111111",
    ))
    calls.append(_research_call(
        "noni_web_search", sequence=4, brief_id="brief-1",
        evidence_id="ev-2222222222222222",
    ))

    evidence = validate_noni_skill_trace(
        calls, brief_id="brief-1", brief_text="Agent approval workflow terminology",
    )

    assert evidence == {
        "ev-1111111111111111": ("https://example.com/source",),
        "ev-2222222222222222": (
            "Ground responses with live web search.",
            "Search grounding",
            "https://dev.meta.ai/docs/search-grounding",
        ),
    }


def test_noni_trace_rejects_cross_brief_research_and_unprovenanced_results():
    wrong_brief = _trace("references/persuasion.md")
    wrong_brief.append(_research_call(
        "noni_web_search", sequence=3, brief_id="brief-other",
        evidence_id="ev-2222222222222222",
    ))
    with pytest.raises(ValueError, match="exact brief"):
        validate_noni_skill_trace(
            wrong_brief, brief_id="brief-1", brief_text="Agent approval workflow terminology",
        )

    missing_evidence = _trace("references/persuasion.md")
    call = _research_call(
        "noni_web_search", sequence=3, brief_id="brief-1",
        evidence_id="ev-2222222222222222",
    )
    call["response"]["research"]["sources"] = []
    missing_evidence.append(call)
    with pytest.raises(ValueError, match="provenance"):
        validate_noni_skill_trace(
            missing_evidence, brief_id="brief-1", brief_text="Agent approval workflow terminology",
        )


def test_noni_trace_rejects_research_outside_the_active_brief():
    calls = _trace("references/persuasion.md")
    call = _research_call(
        "noni_web_search", sequence=3, brief_id="brief-1",
        evidence_id="ev-2222222222222222",
    )
    call["args"]["request"] = "Research celebrity fashion gossip."
    call["response"]["research"]["query"] = "celebrity fashion gossip"
    calls.append(call)

    with pytest.raises(ValueError, match="outside the active brief"):
        validate_noni_skill_trace(
            calls, brief_id="brief-1", brief_text="Agent approval workflow terminology",
        )


def test_noni_trace_rejects_web_search_source_missing_from_provenance():
    calls = _trace("references/persuasion.md")
    call = _research_call(
        "noni_web_search", sequence=3, brief_id="brief-1",
        evidence_id="ev-2222222222222222",
    )
    call["response"]["research"]["sources"][0]["url"] = "https://example.com/invented"
    calls.append(call)

    with pytest.raises(ValueError, match="absent from web search provenance"):
        validate_noni_skill_trace(
            calls, brief_id="brief-1", brief_text="Agent approval workflow terminology",
        )


@pytest.mark.parametrize("name", ["run_skill_script", "search_trend_signals", "get_operator_feed"])
def test_noni_trace_rejects_scripts_research_and_workspace_tools(name):
    calls = _trace("references/persuasion.md")
    calls.append({"sequence": 3, "name": name, "args": {}})

    with pytest.raises(ValueError, match="prohibited tool"):
        validate_noni_skill_trace(calls)


def test_noni_trace_rejects_wrong_skill_duplicate_resources_and_bad_sequence():
    wrong = _trace("references/storytelling.md")
    wrong[0]["args"]["skill_name"] = "trend-scan"
    with pytest.raises(ValueError, match="noni-writing-skills"):
        validate_noni_skill_trace(wrong)

    duplicate = _trace("references/storytelling.md", "references/storytelling.md")
    with pytest.raises(ValueError, match="duplicate"):
        validate_noni_skill_trace(duplicate)

    sequence = _trace("references/storytelling.md")
    sequence[1]["sequence"] = 4
    with pytest.raises(ValueError, match="sequence"):
        validate_noni_skill_trace(sequence)
