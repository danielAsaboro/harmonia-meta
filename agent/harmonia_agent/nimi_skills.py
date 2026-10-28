"""Project-owned filesystem analysis skill for Nimi."""

from __future__ import annotations

from pathlib import Path
from functools import lru_cache
from typing import Any

from google.adk.agents.context import Context
from google.adk.skills import load_skill_from_dir
from google.adk.tools import skill_toolset
from google.adk.tools.base_tool import BaseTool

from .authority_records import skill_activation_records, validate_skill_activation

NIMI_SKILL_NAME = "nimi-analysis-skills"
NIMI_SKILL_TRACE_KEY = "nimi_analysis_skill_trace"
NIMI_SKILL_ROOT = Path(__file__).parent / "skills" / NIMI_SKILL_NAME
NIMI_SKILL_REFERENCES = (
    "references/evidence-observation-and-provenance.md",
    "references/moment-and-quote-extraction.md",
    "references/visual-and-clip-analysis.md",
    "references/themes-tensions-and-patterns.md",
    "references/angle-development.md",
    "references/performance-and-memory-interpretation.md",
    "references/uncertainty-and-analysis-critique.md",
)
_LOAD_TOOLS = frozenset({"load_skill", "load_skill_resource"})


def build_nimi_analysis_skillset() -> skill_toolset.SkillToolset:
    skill = load_skill_from_dir(NIMI_SKILL_ROOT)
    if skill.frontmatter.name != NIMI_SKILL_NAME:
        raise RuntimeError("Nimi analysis skill name does not match its runtime contract")
    return skill_toolset.SkillToolset(skills=[skill], tool_filter=sorted(_LOAD_TOOLS))


def reset_nimi_skill_trace(callback_context: Context) -> None:
    callback_context.state[NIMI_SKILL_TRACE_KEY] = []


@lru_cache(maxsize=1)
def nimi_analysis_skill_context() -> str:
    """Load the project-owned Nimi skill and every approved method reference."""
    skill = load_skill_from_dir(NIMI_SKILL_ROOT)
    if skill.frontmatter.name != NIMI_SKILL_NAME:
        raise RuntimeError("Nimi analysis skill name does not match its runtime contract")
    resources = skill.resources.model_dump().get("references") or {}
    sections = ["Nimi evidence analyst runtime skill:", skill.instructions]
    for reference in NIMI_SKILL_REFERENCES:
        name = Path(reference).name
        content = resources.get(name)
        if not isinstance(content, str) or not content.strip():
            raise RuntimeError(f"Nimi analysis skill reference is missing: {reference}")
        sections.extend((f"\n## Loaded {reference}", content))
    return "\n".join(sections)


def bootstrap_nimi_skill_context(callback_context: Context) -> None:
    """Deterministically load Nimi's owned skill before model inference."""
    callback_context.state["nimi_analysis_skill_context"] = nimi_analysis_skill_context()
    callback_context.state[NIMI_SKILL_TRACE_KEY] = skill_activation_records(
        skill_name=NIMI_SKILL_NAME,
        skill_root=NIMI_SKILL_ROOT,
        references=NIMI_SKILL_REFERENCES,
    )


def _skill_name(args: dict[str, Any]) -> str | None:
    value = args.get("skill_name") or args.get("name")
    return value if isinstance(value, str) else None


def _resource_path(args: dict[str, Any]) -> str | None:
    value = args.get("file_path")
    return value if isinstance(value, str) else None


def guard_nimi_skill_tool(tool: BaseTool, args: dict[str, Any]) -> None:
    if tool.name not in _LOAD_TOOLS:
        raise ValueError(f"Nimi used a prohibited skill tool: {tool.name}")
    if _skill_name(args) != NIMI_SKILL_NAME:
        raise ValueError("Nimi may load only nimi-analysis-skills")
    if tool.name == "load_skill_resource" and _resource_path(args) not in NIMI_SKILL_REFERENCES:
        raise ValueError(f"Nimi loaded an unapproved resource: {_resource_path(args)}")


def record_nimi_skill_tool(tool: BaseTool, args: dict[str, Any], tool_context: Context) -> None:
    trace = list(tool_context.state.get(NIMI_SKILL_TRACE_KEY) or [])
    trace.append({"sequence": len(trace) + 1, "name": tool.name, "args": dict(args)})
    tool_context.state[NIMI_SKILL_TRACE_KEY] = trace


def validate_nimi_skill_trace(trace: list[dict[str, Any]]) -> None:
    if trace and trace[0].get("kind") == "skill_activation":
        validate_skill_activation(
            trace,
            skill_name=NIMI_SKILL_NAME,
            skill_root=NIMI_SKILL_ROOT,
            allowed_references=NIMI_SKILL_REFERENCES,
        )
        return
    if not trace or trace[0].get("name") != "load_skill" or sum(item.get("name") == "load_skill" for item in trace) != 1:
        raise ValueError("Nimi must load nimi-analysis-skills exactly once first")
    if [item.get("sequence") for item in trace] != list(range(1, len(trace) + 1)):
        raise ValueError("Nimi analysis-skill trace sequence is invalid")
    if _skill_name(trace[0].get("args") or {}) != NIMI_SKILL_NAME:
        raise ValueError("Nimi may load only nimi-analysis-skills")
    resources: list[str] = []
    for item in trace[1:]:
        if item.get("name") != "load_skill_resource":
            raise ValueError(f"Nimi used a prohibited skill tool: {item.get('name')}")
        args = item.get("args") or {}
        if _skill_name(args) != NIMI_SKILL_NAME:
            raise ValueError("Nimi may load resources only from nimi-analysis-skills")
        path = _resource_path(args)
        if path not in NIMI_SKILL_REFERENCES:
            raise ValueError(f"Nimi loaded an unapproved resource: {path}")
        resources.append(path)
    if not resources:
        raise ValueError("Nimi must load at least one analysis reference")
    if len(resources) != len(set(resources)):
        raise ValueError("Nimi loaded a duplicate analysis reference")
