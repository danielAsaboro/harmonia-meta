"""Temi's filesystem planning skill and immutable snapshot read tools."""

from __future__ import annotations

from copy import deepcopy
import logging
from pathlib import Path
from typing import Any

from google.adk.agents.context import Context
from google.adk.skills import load_skill_from_dir
from google.adk.tools import FunctionTool, ToolContext, skill_toolset
from google.adk.tools.base_tool import BaseTool

from .authority_records import (
    authority_read_record,
    skill_activation_records,
    validate_authority_read,
    validate_skill_activation,
)

logger = logging.getLogger("harmonia.temi_skills")

TEMI_SKILL_NAME = "temi-editorial-planning-skills"
TEMI_TRACE_KEY = "temi_editorial_planning_trace"
TEMI_SKILL_ROOT = Path(__file__).parent / "skills" / TEMI_SKILL_NAME
TEMI_SKILL_REFERENCES = (
    "references/strategy-to-editorial-plan.md",
    "references/calendar-sequencing-and-cadence.md",
    "references/capacity-dependencies-and-deadlines.md",
    "references/channel-format-and-portfolio-allocation.md",
    "references/priority-and-next-item-selection.md",
    "references/replanning-and-calendar-critique.md",
)
_LOAD_TOOLS = frozenset({"load_skill", "load_skill_resource"})
_READ_FIELDS = {
    "read_planning_authority": ("planningAuthority", "planningSnapshot"),
    "read_editorial_commitments": ("commitments", "existingCommitments"),
    "read_production_capacity": ("productionCapacity", "productionCapacity"),
    "read_asset_readiness": ("assetReadiness", "assetReadiness"),
    "read_posting_window_observations": ("observations", "postingWindowObservations"),
    "read_calendar_projection": ("calendarProjection", "calendarProjection"),
    "read_blocked_dependencies": ("blockedDependencies", "blockedDependencies"),
}

_PLANNING_AUTHORITY_KEYS = (
    "strategy", "strategyDigest", "strategyVersion", "strategyApproval",
    "analysis", "planningSnapshot", "planningSnapshotDigest", "revision",
    "replanningFeedback",
)


def _read(snapshot_id: str, tool_context: ToolContext, field: str, output: str) -> dict[str, Any]:
    snapshot = tool_context.state.get("planningSnapshot")
    if not isinstance(snapshot, dict) or snapshot.get("snapshotId") != snapshot_id:
        logger.warning(
            "Temi snapshot read rejected binding present=%s matches=%s",
            isinstance(snapshot, dict),
            isinstance(snapshot, dict) and snapshot.get("snapshotId") == snapshot_id,
        )
        raise ValueError("Temi may read only the exact planning snapshot")
    return {"snapshotId": snapshot_id, output: deepcopy(snapshot[field])}


def read_editorial_commitments(snapshot_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Read immutable existing commitments from the active planning snapshot."""
    return _read(snapshot_id, tool_context, "existingCommitments", "commitments")


def read_planning_authority(snapshot_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Read the exact typed planning authority already bound to this session."""
    snapshot = tool_context.state.get("planningSnapshot")
    if not isinstance(snapshot, dict) or snapshot.get("snapshotId") != snapshot_id:
        raise ValueError("Temi may read only the exact planning snapshot")
    return {
        "snapshotId": snapshot_id,
        **deepcopy({
            key: tool_context.state[key]
            for key in _PLANNING_AUTHORITY_KEYS if key in tool_context.state
        }),
    }


def read_production_capacity(snapshot_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Read immutable production capacity from the active planning snapshot."""
    return _read(snapshot_id, tool_context, "productionCapacity", "productionCapacity")


def read_asset_readiness(snapshot_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Read immutable asset-readiness records from the active planning snapshot."""
    return _read(snapshot_id, tool_context, "assetReadiness", "assetReadiness")


def read_posting_window_observations(snapshot_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Read verified posting-window observations from the active planning snapshot."""
    return _read(snapshot_id, tool_context, "postingWindowObservations", "observations")


def read_calendar_projection(snapshot_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Read downstream calendar projection state without mutating the calendar."""
    return _read(snapshot_id, tool_context, "calendarProjection", "calendarProjection")


def read_blocked_dependencies(snapshot_id: str, tool_context: ToolContext) -> dict[str, Any]:
    """Read immutable blocked production dependencies from the active snapshot."""
    return _read(snapshot_id, tool_context, "blockedDependencies", "blockedDependencies")


_READ_TOOLS = (
    read_planning_authority, read_editorial_commitments, read_production_capacity, read_asset_readiness,
    read_posting_window_observations, read_calendar_projection, read_blocked_dependencies,
)


def build_temi_editorial_planning_skillset() -> skill_toolset.SkillToolset:
    skill = load_skill_from_dir(TEMI_SKILL_ROOT)
    if skill.frontmatter.name != TEMI_SKILL_NAME:
        raise RuntimeError("Temi planning skill name does not match its runtime contract")
    return skill_toolset.SkillToolset(
        skills=[skill], tool_filter=sorted({*_LOAD_TOOLS, *_READ_FIELDS}),
        additional_tools=[FunctionTool(tool) for tool in _READ_TOOLS],
    )


def build_temi_planning_read_tools() -> list[FunctionTool]:
    return [FunctionTool(tool) for tool in _READ_TOOLS]


def compiled_temi_planning_skill_context() -> str:
    files = [TEMI_SKILL_ROOT / "SKILL.md", *(TEMI_SKILL_ROOT / path for path in TEMI_SKILL_REFERENCES)]
    return "\n\n".join(
        f"## {path.relative_to(TEMI_SKILL_ROOT)}\n{path.read_text(encoding='utf-8').strip()}"
        for path in files
    )


def bootstrap_temi_trace(callback_context: Context) -> None:
    trace = skill_activation_records(
        skill_name=TEMI_SKILL_NAME,
        skill_root=TEMI_SKILL_ROOT,
        references=TEMI_SKILL_REFERENCES,
    )
    snapshot = callback_context.state.get("planningSnapshot")
    if isinstance(snapshot, dict) and isinstance(snapshot.get("snapshotId"), str):
        trace.append(authority_read_record(
            authority="planning_snapshot",
            authority_id=snapshot["snapshotId"],
            value=snapshot,
            sequence=len(trace) + 1,
        ))
    callback_context.state[TEMI_TRACE_KEY] = trace


def reset_temi_trace(callback_context: Context) -> None:
    callback_context.state[TEMI_TRACE_KEY] = []


def _skill_name(args: dict[str, Any]) -> str | None:
    value = args.get("skill_name") or args.get("name")
    return value if isinstance(value, str) else None


def guard_temi_tool(tool: BaseTool, args: dict[str, Any], tool_context: Context) -> None:
    if tool.name == "set_model_response":
        return
    allowed = {*_LOAD_TOOLS, *_READ_FIELDS}
    if tool.name not in allowed:
        logger.warning("Temi tool boundary rejected prohibited tool name=%s", tool.name)
        raise ValueError(f"Temi used a prohibited tool: {tool.name}")
    if tool.name in _LOAD_TOOLS:
        if _skill_name(args) != TEMI_SKILL_NAME:
            logger.warning("Temi tool boundary rejected wrong skill identity")
            raise ValueError("Temi may load only temi-editorial-planning-skills")
        if tool.name == "load_skill_resource" and args.get("file_path") not in TEMI_SKILL_REFERENCES:
            logger.warning("Temi tool boundary rejected unapproved planning reference")
            raise ValueError(f"Temi loaded an unapproved resource: {args.get('file_path')}")
        return
    snapshot = tool_context.state.get("planningSnapshot")
    if not isinstance(snapshot, dict) or args.get("snapshot_id") != snapshot.get("snapshotId"):
        logger.warning(
            "Temi tool boundary rejected snapshot binding present=%s matches=%s",
            isinstance(snapshot, dict),
            isinstance(snapshot, dict) and args.get("snapshot_id") == snapshot.get("snapshotId"),
        )
        raise ValueError("Temi may read only the exact planning snapshot")


def record_temi_tool(tool: BaseTool, args: dict[str, Any], tool_context: Context, tool_response: dict[str, Any]) -> None:
    if tool.name == "set_model_response":
        return
    trace = list(tool_context.state.get(TEMI_TRACE_KEY) or [])
    entry: dict[str, Any] = {"sequence": len(trace) + 1, "name": tool.name, "args": dict(args)}
    if tool.name in _READ_FIELDS:
        entry["response"] = tool_response
    trace.append(entry)
    tool_context.state[TEMI_TRACE_KEY] = trace


def validate_temi_trace(
    trace: list[dict[str, Any]], *, snapshot_id: str,
    snapshot: dict[str, Any] | None = None,
) -> None:
    if trace and trace[0].get("kind") == "skill_activation":
        activations = trace[:-1]
        validate_skill_activation(
            activations, skill_name=TEMI_SKILL_NAME, skill_root=TEMI_SKILL_ROOT,
            allowed_references=TEMI_SKILL_REFERENCES,
        )
        read = trace[-1]
        if read.get("kind") != "authority_read" or read.get("authorityId") != snapshot_id:
            raise ValueError("Temi must bind the exact planning snapshot")
        if snapshot is not None:
            validate_authority_read(
                read, authority="planning_snapshot", authority_id=snapshot_id,
                value=snapshot,
            )
        return
    if not trace or trace[0].get("name") != "load_skill" or sum(item.get("name") == "load_skill" for item in trace) != 1:
        raise ValueError("Temi must load temi-editorial-planning-skills exactly once first")
    if [item.get("sequence") for item in trace] != list(range(1, len(trace) + 1)):
        raise ValueError("Temi planning trace sequence is invalid")
    if _skill_name(trace[0].get("args") or {}) != TEMI_SKILL_NAME:
        raise ValueError("Temi may load only temi-editorial-planning-skills")
    resources: list[str] = []
    reads = 0
    read_started = False
    for item in trace[1:]:
        name = item.get("name")
        args = item.get("args") or {}
        if name == "load_skill_resource":
            if read_started:
                raise ValueError("Temi must load planning references before planning-data reads")
            if _skill_name(args) != TEMI_SKILL_NAME or args.get("file_path") not in TEMI_SKILL_REFERENCES:
                raise ValueError(f"Temi loaded an unapproved resource: {args.get('file_path')}")
            resources.append(args["file_path"])
            continue
        if name not in _READ_FIELDS:
            raise ValueError(f"Temi used a prohibited tool: {name}")
        read_started = True
        reads += 1
        if args.get("snapshot_id") != snapshot_id:
            raise ValueError("Temi must read the exact planning snapshot")
        response = item.get("response")
        if not isinstance(response, dict) or response.get("snapshotId") != snapshot_id:
            raise ValueError("Temi planning read lacks request-bound provenance")
    if not resources:
        raise ValueError("Temi must load at least one planning reference")
    if len(resources) != len(set(resources)):
        raise ValueError("Temi loaded a duplicate planning reference")
    if reads == 0:
        raise ValueError(
            "Temi must read a planning snapshot section with a request-bound planning snapshot read tool"
        )
