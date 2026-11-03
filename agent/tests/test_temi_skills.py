"""Temi's project-owned planning skill and request-bound read tools."""

from __future__ import annotations

import asyncio
from copy import deepcopy
from types import SimpleNamespace

import pytest

from harmonia_agent.temi_skills import (
    TEMI_SKILL_NAME,
    TEMI_SKILL_REFERENCES,
    TEMI_TRACE_KEY,
    build_temi_editorial_planning_skillset,
    bootstrap_temi_trace,
    guard_temi_tool,
    read_planning_authority,
    validate_temi_trace,
)


def trace(resource: str = TEMI_SKILL_REFERENCES[0]) -> list[dict]:
    return [
        {"sequence": 1, "name": "load_skill", "args": {"skill_name": TEMI_SKILL_NAME}},
        {"sequence": 2, "name": "load_skill_resource", "args": {
            "skill_name": TEMI_SKILL_NAME, "file_path": resource,
        }},
        {"sequence": 3, "name": "read_editorial_commitments", "args": {
            "snapshot_id": "planning-job-1-v1",
        }, "response": {"snapshotId": "planning-job-1-v1", "commitments": []}},
    ]


def test_temi_exposes_one_filesystem_skill_and_separate_read_only_tools():
    toolset = build_temi_editorial_planning_skillset()
    loader_names = {tool.name for tool in asyncio.run(toolset.get_tools())}
    names = loader_names | set(toolset._provided_tools_by_name)
    assert {"load_skill", "load_skill_resource"}.issubset(loader_names)
    assert {
        "read_planning_authority",
        "read_editorial_commitments", "read_production_capacity",
        "read_asset_readiness", "read_posting_window_observations",
        "read_calendar_projection", "read_blocked_dependencies",
    }.issubset(names)
    assert not names.intersection({"google_search", "approve", "schedule", "publish"})


def test_temi_skill_activation_declares_every_request_bound_read_tool():
    toolset = build_temi_editorial_planning_skillset()
    skill = toolset._skills[TEMI_SKILL_NAME]

    assert set(skill.frontmatter.metadata["adk_additional_tools"]) == {
        "read_editorial_commitments",
        "read_production_capacity",
        "read_asset_readiness",
        "read_posting_window_observations",
        "read_calendar_projection",
        "read_blocked_dependencies",
    }


def test_temi_requires_exactly_one_skill_then_references_then_snapshot_reads():
    assert validate_temi_trace(trace(), snapshot_id="planning-job-1-v1") is None

    typed_payload_trace = trace()[:2]
    with pytest.raises(ValueError, match="request-bound planning snapshot read tool"):
        validate_temi_trace(
            typed_payload_trace, snapshot_id="planning-job-1-v1",
        )

    duplicate = trace()
    duplicate.insert(1, deepcopy(duplicate[0]))
    with pytest.raises(ValueError, match="exactly once first"):
        validate_temi_trace(duplicate, snapshot_id="planning-job-1-v1")

    wrong_order = trace()
    wrong_order[1], wrong_order[2] = wrong_order[2], wrong_order[1]
    for sequence, item in enumerate(wrong_order, 1): item["sequence"] = sequence
    with pytest.raises(ValueError, match="before planning-data reads"):
        validate_temi_trace(wrong_order, snapshot_id="planning-job-1-v1")


def test_temi_rejects_unapproved_duplicate_and_cross_request_resources_or_reads():
    unapproved = trace("references/not-approved.md")
    with pytest.raises(ValueError, match="unapproved resource"):
        validate_temi_trace(unapproved, snapshot_id="planning-job-1-v1")

    duplicate = trace()
    duplicate.insert(2, deepcopy(duplicate[1]))
    for sequence, item in enumerate(duplicate, 1): item["sequence"] = sequence
    with pytest.raises(ValueError, match="duplicate planning reference"):
        validate_temi_trace(duplicate, snapshot_id="planning-job-1-v1")

    cross_request = trace()
    cross_request[-1]["args"]["snapshot_id"] = "planning-other-v1"
    with pytest.raises(ValueError, match="exact planning snapshot"):
        validate_temi_trace(cross_request, snapshot_id="planning-job-1-v1")


def test_guard_rejects_unknown_tools_and_wrong_snapshot_before_execution():
    context = SimpleNamespace(state={"planningSnapshot": {"snapshotId": "planning-job-1-v1"}})
    with pytest.raises(ValueError, match="prohibited tool"):
        guard_temi_tool(SimpleNamespace(name="google_search"), {}, context)
    with pytest.raises(ValueError, match="exact planning snapshot"):
        guard_temi_tool(
            SimpleNamespace(name="read_editorial_commitments"),
            {"snapshot_id": "planning-other-v1"}, context,
        )
    assert TEMI_TRACE_KEY


def test_host_bootstrap_records_exact_skill_references_and_snapshot_reads():
    snapshot = {
        "snapshotId": "planning-job-1-v1",
        "existingCommitments": [],
        "productionCapacity": {"weeklyHours": 4},
        "assetReadiness": [],
        "postingWindowObservations": [],
        "calendarProjection": [],
        "blockedDependencies": [],
    }
    context = SimpleNamespace(state={"planningSnapshot": snapshot})

    bootstrap_temi_trace(context)

    recorded = context.state[TEMI_TRACE_KEY]
    assert [item["sequence"] for item in recorded] == list(range(1, len(recorded) + 1))
    assert [item["kind"] for item in recorded[:7]] == [
        "skill_activation", *("skill_resource_activation" for _ in TEMI_SKILL_REFERENCES),
    ]
    assert recorded[7]["kind"] == "authority_read"
    assert recorded[7]["authority"] == "planning_snapshot"
    assert recorded[7]["authorityId"] == snapshot["snapshotId"]
    assert "response" not in recorded[7]
    validate_temi_trace(recorded, snapshot_id=snapshot["snapshotId"], snapshot=snapshot)
