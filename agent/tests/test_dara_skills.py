"""Dara's filesystem editing skill and deterministic resource boundary."""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from google.adk.tools import skill_toolset

from harmonia_agent.dara_skills import (
    DARA_SKILL_NAME,
    DARA_SKILL_REFERENCES,
    build_dara_editing_skillset,
    guard_dara_skill_tool,
    reset_dara_skill_trace,
    validate_dara_skill_trace,
)
from harmonia_agent.agent_errors import AgentContractError
from harmonia_agent.agent_models import EditorialReviewInput
from harmonia_agent.agents import _validate_run_output, build_agent_team
from tests.test_dara_contracts import passing_assessment
from tests.test_noni_contracts import grounded_draft, original_input


def _trace(*resources: str) -> list[dict]:
    calls = [{
        "sequence": 1, "name": "load_skill",
        "args": {"skill_name": DARA_SKILL_NAME},
    }]
    calls.extend({
        "sequence": index, "name": "load_skill_resource",
        "args": {"skill_name": DARA_SKILL_NAME, "file_path": resource},
    } for index, resource in enumerate(resources, start=2))
    return calls


def test_dara_skillset_exposes_only_skill_and_resource_loaders():
    toolset = build_dara_editing_skillset()
    assert isinstance(toolset, skill_toolset.SkillToolset)
    assert [skill.frontmatter.name for skill in toolset.skills] == [DARA_SKILL_NAME]
    assert {tool.name for tool in asyncio.run(toolset.get_tools())} == {
        "load_skill", "load_skill_resource",
    }


def test_dara_reference_allow_list_is_small_complete_and_loadable():
    assert DARA_SKILL_REFERENCES == (
        "references/editorial-triage.md",
        "references/grounding-and-claims.md",
        "references/structure-and-clarity.md",
        "references/brief-voice-and-audience.md",
        "references/platform-cta-and-usability.md",
        "references/safety-and-inclusive-editing.md",
        "references/feedback-and-revision.md",
    )
    assert validate_dara_skill_trace(_trace(DARA_SKILL_REFERENCES[0])) == {}


@pytest.mark.parametrize(("calls", "message"), [
    ([], "exactly once first"),
    (_trace(), "at least one editing reference"),
    (_trace("references/source-coverage.md"), "unapproved resource"),
    (_trace("references/editorial-triage.md", "references/editorial-triage.md"), "duplicate"),
])
def test_dara_trace_rejects_missing_unapproved_and_duplicate_resources(calls, message):
    with pytest.raises(ValueError, match=message):
        validate_dara_skill_trace(calls)


def test_dara_trace_rejects_wrong_skill_invalid_order_and_other_tools():
    wrong = _trace(DARA_SKILL_REFERENCES[0])
    wrong[0]["args"]["skill_name"] = "noni-writing-skills"
    with pytest.raises(ValueError, match="only dara-editing-skills"):
        validate_dara_skill_trace(wrong)

    unordered = _trace(DARA_SKILL_REFERENCES[0])
    unordered[1]["sequence"] = 3
    with pytest.raises(ValueError, match="sequence"):
        validate_dara_skill_trace(unordered)

    prohibited = _trace(DARA_SKILL_REFERENCES[0])
    prohibited.append({"sequence": 3, "name": "google_search", "args": {}})
    with pytest.raises(ValueError, match="prohibited tool"):
        validate_dara_skill_trace(prohibited)


def test_guard_blocks_unapproved_resource_before_adk_loads_it():
    with pytest.raises(ValueError, match="unapproved resource"):
        guard_dara_skill_tool(
            SimpleNamespace(name="load_skill_resource"),
            {"skill_name": DARA_SKILL_NAME, "file_path": "references/source-coverage.md"},
            SimpleNamespace(),
        )


def test_source_coverage_ledger_accounts_for_every_selected_piece():
    ledger = (Path(__file__).parents[1] / "harmonia_agent/skills/dara-editing-skills/references/source-coverage.md").read_text()
    slugs = [
        "episode-25-the-role-of-editing-in-content-marketing",
        "content-writing-guide", "quality-content",
        "mece-mutually-exclusive-collectively-exhaustive", "bottom-line-up-front",
        "the-problem-with-writing-is-thinking", "bad-content",
        "episode-21-how-to-give-and-receive-creative-feedback",
        "persuade-like-a-lawyer", "inclusive-content",
    ]
    assert all(ledger.count(f"https://www.animalz.co/blog/{slug}") == 1 for slug in slugs)


def test_dara_runtime_is_wired_to_bounded_skill_callbacks():
    team = build_agent_team(model="muse-test")
    dara = next(agent for agent in team.sub_agents if agent.name == "dara_editor")
    assert len(dara.tools) == 1
    assert isinstance(dara.tools[0], skill_toolset.SkillToolset)
    assert dara.before_agent_callback is reset_dara_skill_trace
    assert dara.before_tool_callback is guard_dara_skill_tool
    assert dara.after_tool_callback.__name__ == "record_dara_skill_tool"


def test_dara_runtime_rejects_missing_trace_and_accepts_valid_actual_trace():
    supplied = EditorialReviewInput(copywriterInput=original_input(), draft=grounded_draft())
    state = {"editorial_assessment": passing_assessment()}
    with pytest.raises(AgentContractError) as exc:
        _validate_run_output("dara_editor", supplied, state)
    assert "editing-skill trace" in str(exc.value.__cause__)

    state["dara_editing_skill_trace"] = _trace(DARA_SKILL_REFERENCES[0])
    _validate_run_output("dara_editor", supplied, state)
