"""Project-owned ADK strategy skill and fail-closed resource trace for Ryan."""

from __future__ import annotations

from pathlib import Path
import json
import re
from typing import Any

from google.adk.models.base_llm import BaseLlm
from google.adk.agents.context import Context
from google.adk.skills import load_skill_from_dir
from google.adk.tools import skill_toolset
from google.adk.tools.base_tool import BaseTool
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .authority_records import skill_activation_records, validate_skill_activation
from .meta_search import MetaWebSearchTool, require_cited_source, search_model_id, search_response

RYAN_SKILL_NAME = "ryan-strategy-skills"
RYAN_SKILL_TRACE_KEY = "ryan_strategy_skill_trace"
RYAN_RESEARCH_DISPATCH_KEY = "temp:ryan_research_dispatched"
RYAN_SKILL_ROOT = Path(__file__).parent / "skills" / RYAN_SKILL_NAME
RYAN_SKILL_REFERENCES = (
    "references/strategic-diagnosis.md",
    "references/positioning-and-thesis.md",
    "references/campaign-and-portfolio.md",
    "references/channels-formats-and-cadence.md",
    "references/funnel-cta-and-measurement.md",
    "references/source-grounded-briefs.md",
    "references/evidence-learning-and-revision.md",
)
_LOAD_TOOLS = frozenset({"load_skill", "load_skill_resource"})
RYAN_SEARCH_TOOL = "ryan_web_search"


def build_ryan_strategy_skillset() -> skill_toolset.SkillToolset:
    """Expose one filesystem skill and only its bounded resource loaders."""
    skill = load_skill_from_dir(RYAN_SKILL_ROOT)
    if skill.frontmatter.name != RYAN_SKILL_NAME:
        raise RuntimeError("Ryan strategy skill name does not match its runtime contract")
    return skill_toolset.SkillToolset(
        skills=[skill],
        tool_filter=sorted(_LOAD_TOOLS),
    )


def compiled_ryan_strategy_skill_context() -> str:
    """Compile the fixed, approved strategy skill before model inference."""
    files = [RYAN_SKILL_ROOT / "SKILL.md", *(RYAN_SKILL_ROOT / path for path in RYAN_SKILL_REFERENCES)]
    return "\n\n".join(
        f"## {path.relative_to(RYAN_SKILL_ROOT)}\n{path.read_text(encoding='utf-8').strip()}"
        for path in files
    )


def bootstrap_ryan_skill_trace(callback_context: Context) -> None:
    callback_context.state[RYAN_RESEARCH_DISPATCH_KEY] = False
    callback_context.state[RYAN_SKILL_TRACE_KEY] = skill_activation_records(
        skill_name=RYAN_SKILL_NAME,
        skill_root=RYAN_SKILL_ROOT,
        references=RYAN_SKILL_REFERENCES,
    )


class GroundedStrategySource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidenceId: str = Field(pattern=r"^search-[A-Za-z0-9][A-Za-z0-9._:-]{0,92}$")
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(min_length=8, max_length=2_000)
    supportedText: str = Field(min_length=1, max_length=1_000)

    @field_validator("url")
    @classmethod
    def require_public_url(cls, value: str) -> str:
        if not value.startswith(("https://", "http://")):
            raise ValueError("grounded source URL must be public HTTP(S)")
        return value


class GroundedStrategyResearch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: str = Field(min_length=1, max_length=100)
    query: str = Field(min_length=1, max_length=500)
    sources: list[GroundedStrategySource] = Field(min_length=1, max_length=8)


def build_ryan_web_search_tool(model: str | BaseLlm) -> MetaWebSearchTool:
    """Isolate Meta web search from Ryan's filesystem tools in its own request."""
    return MetaWebSearchTool(
        name=RYAN_SEARCH_TOOL,
        description="Meta web search grounding for one exact Ryan strategy research request.",
        instructions=(
            "Search the web only for the exact request ID, question, and justification supplied. "
            "Prefer primary sources and current information. Return strict GroundedStrategyResearch "
            "JSON with the unchanged requestId, actual query, stable search-* evidence IDs, and for "
            "each source the exact title and URL of a search result plus supportedText copied "
            "verbatim from that result. Never analyze Harmonia's private source, invent customer "
            "research, change strategy, authorize an action, or access private data."
        ),
        output_model=GroundedStrategyResearch,
        model_id=search_model_id(model),
    )


def reset_ryan_skill_trace(callback_context: Context) -> None:
    callback_context.state[RYAN_SKILL_TRACE_KEY] = []


def _skill_name(args: dict[str, Any]) -> str | None:
    value = args.get("skill_name") or args.get("name")
    return value if isinstance(value, str) else None


def _resource_path(args: dict[str, Any]) -> str | None:
    value = args.get("file_path")
    return value if isinstance(value, str) else None


def guard_ryan_skill_tool(
    tool: BaseTool, args: dict[str, Any], tool_context: Context,
) -> None:
    """Reject disallowed loaders and paths before ADK reads the resource."""
    if tool.name == "set_model_response":
        return
    if tool.name not in {*_LOAD_TOOLS, RYAN_SEARCH_TOOL}:
        raise ValueError(f"Ryan used a prohibited tool: {tool.name}")
    if tool.name == RYAN_SEARCH_TOOL:
        request = tool_context.state.get("researchRequest")
        if not isinstance(request, dict) or not request:
            raise ValueError("Ryan requires an authorized research request before search")
        supplied = args.get("request")
        if isinstance(supplied, str):
            try:
                supplied = json.loads(supplied)
            except json.JSONDecodeError as exc:
                raise ValueError("Ryan search must use the exact research request") from exc
        if supplied != request:
            raise ValueError("Ryan search must use the exact research request")
        if tool_context.state.get(RYAN_RESEARCH_DISPATCH_KEY) or any(item.get("name") == RYAN_SEARCH_TOOL for item in tool_context.state.get(RYAN_SKILL_TRACE_KEY, [])):
            raise ValueError("Ryan may search only once per authorized request")
        # ADK can dispatch parallel function calls. Reserve synchronously before
        # either call can await the provider, not after its result is recorded.
        tool_context.state[RYAN_RESEARCH_DISPATCH_KEY] = True
        return
    if _skill_name(args) != RYAN_SKILL_NAME:
        raise ValueError("Ryan may load only ryan-strategy-skills")
    if tool.name == "load_skill_resource" and _resource_path(args) not in RYAN_SKILL_REFERENCES:
        raise ValueError(f"Ryan loaded an unapproved resource: {_resource_path(args)}")


def record_ryan_skill_tool(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: Context,
    tool_response: dict[str, Any],
) -> None:
    """Record only loader identity and arguments; skill prose is not evidence."""
    if tool.name == "set_model_response":
        return
    trace = list(tool_context.state.get(RYAN_SKILL_TRACE_KEY) or [])
    entry = {
        "sequence": len(trace) + 1,
        "kind": "tool_call",
        "name": tool.name,
        "args": dict(args),
    }
    if tool.name == RYAN_SEARCH_TOOL:
        entry["response"] = tool_response
    trace.append(entry)
    tool_context.state[RYAN_SKILL_TRACE_KEY] = trace


def validate_ryan_skill_trace(
    trace: list[dict[str, Any]], *, research_request: Any | None = None,
) -> dict[str, tuple[str, ...]]:
    """Fail closed unless Ryan loaded one skill and approved references only."""
    if trace and trace[0].get("kind") == "skill_activation":
        activation_count = next(
            (index for index, item in enumerate(trace) if item.get("kind") == "tool_call"),
            len(trace),
        )
        activations = trace[:activation_count]
        validate_skill_activation(
            activations, skill_name=RYAN_SKILL_NAME, skill_root=RYAN_SKILL_ROOT,
            allowed_references=RYAN_SKILL_REFERENCES,
        )
        trace = [
            {"sequence": 1, "name": "load_skill", "args": {"skill_name": RYAN_SKILL_NAME}},
            *[
                {"sequence": index + 2, "name": "load_skill_resource", "args": {
                    "skill_name": RYAN_SKILL_NAME, "file_path": item["resourcePath"],
                }}
                for index, item in enumerate(activations[1:])
            ],
            *[
                {**item, "sequence": len(activations) + index + 1}
                for index, item in enumerate(trace[activation_count:])
            ],
        ]
    if (
        not trace
        or trace[0].get("name") != "load_skill"
        or sum(item.get("name") == "load_skill" for item in trace) != 1
    ):
        raise ValueError("Ryan must load ryan-strategy-skills exactly once first")
    if [item.get("sequence") for item in trace] != list(range(1, len(trace) + 1)):
        raise ValueError("Ryan strategy-skill trace sequence is invalid")
    if _skill_name(trace[0].get("args") or {}) != RYAN_SKILL_NAME:
        raise ValueError("Ryan may load only ryan-strategy-skills")

    resources: list[str] = []
    search_calls: list[dict[str, Any]] = []
    research_started = False
    for item in trace[1:]:
        if item.get("name") == RYAN_SEARCH_TOOL:
            research_started = True
            search_calls.append(item)
            continue
        if item.get("name") != "load_skill_resource":
            raise ValueError(f"Ryan used a prohibited tool: {item.get('name')}")
        if research_started:
            raise ValueError("Ryan must load strategy references before public research")
        args = item.get("args") or {}
        if _skill_name(args) != RYAN_SKILL_NAME:
            raise ValueError("Ryan may load resources only from ryan-strategy-skills")
        path = _resource_path(args)
        if path not in RYAN_SKILL_REFERENCES:
            raise ValueError(f"Ryan loaded an unapproved resource: {path}")
        resources.append(path)
    if not resources:
        raise ValueError("Ryan must load at least one strategy reference")
    if len(resources) != len(set(resources)):
        raise ValueError("Ryan loaded a duplicate strategy reference")
    if research_request is None:
        if search_calls:
            raise ValueError("Ryan searched without a supplied strategy research request")
        return {}
    request = (
        research_request.model_dump(mode="json")
        if hasattr(research_request, "model_dump") else research_request
    )
    if not isinstance(request, dict) or len(search_calls) != 1:
        raise ValueError("Ryan must execute exactly one request-bound search")
    call = search_calls[0]
    call_request = (call.get("args") or {}).get("request")
    if isinstance(call_request, str):
        try:
            call_request = json.loads(call_request)
        except json.JSONDecodeError as exc:
            raise ValueError("Ryan search request must be exact typed JSON") from exc
    if call_request != request:
        raise ValueError("Ryan search must use the exact strategy research request")
    raw, provenance = search_response(call.get("response"), label="Ryan")
    try:
        result = GroundedStrategyResearch.model_validate(raw)
    except ValueError as exc:
        raise ValueError("Ryan web search requires structured provenance") from exc
    if result.requestId != request.get("id"):
        raise ValueError("Ryan search must bind to the exact strategy research request")
    request_terms = set(re.findall(r"[a-z0-9]+", str(request.get("question") or "").lower()))
    query_terms = set(re.findall(r"[a-z0-9]+", result.query.lower()))
    if not {term for term in request_terms if len(term) > 3}.intersection(query_terms):
        raise ValueError("Ryan search query is outside the strategy research request")
    evidence: dict[str, tuple[str, ...]] = {}
    for source in result.sources:
        require_cited_source(
            provenance, url=source.url, title=source.title,
            supported_text=source.supportedText, label="Ryan",
        )
        if source.evidenceId in evidence:
            raise ValueError("Ryan search returned duplicate evidence")
        evidence[source.evidenceId] = (source.supportedText, source.title, source.url)
    return evidence
