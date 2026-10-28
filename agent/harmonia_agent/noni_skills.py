"""Dedicated ADK writing skills and trace validation for Noni."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from google.adk.agents.context import Context
from google.adk.skills import load_skill_from_dir
from google.adk.tools import FunctionTool, skill_toolset
from google.adk.tools.base_tool import BaseTool
from google.adk.models.base_llm import BaseLlm
from pydantic import BaseModel, ConfigDict, Field, field_validator

from . import web_client
from .authority_records import skill_activation_records, validate_skill_activation
from .meta_search import MetaWebSearchTool, require_cited_source, search_model_id, search_response
from .tool_contracts import ToolContract, error, evidence, provider_error, success, validate_tool_envelope

NONI_SKILL_NAME = "noni-writing-skills"
NONI_SKILL_TRACE_KEY = "noni_writing_skill_trace"
NONI_SKILL_ROOT = Path(__file__).parent / "skills" / NONI_SKILL_NAME
NONI_SKILL_REFERENCES = (
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
)
NONI_SEARCH_TOOL = "noni_web_search"
NONI_RESEARCH_TOOLS = ("search_verified_publications", NONI_SEARCH_TOOL)
NONI_ARTIFACT_REFERENCES = (
    "references/thought-leadership.md",
    "references/structure-and-mece.md",
)
_RESEARCH_STOP_WORDS = {
    "about", "after", "brief", "campaign", "content", "different", "find",
    "from", "into", "source", "sources", "that", "their", "this", "verify",
    "with", "write", "writing",
}


def _bounded_text(value: str, *, label: str, maximum: int) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{label} must be non-empty")
    if len(normalized) > maximum:
        raise ValueError(f"{label} exceeds {maximum} characters")
    return normalized


def search_verified_publications(
    brief_id: str, query: str, limit: int = 5,
) -> dict[str, Any]:
    """Search verified prior publications in the active workspace for one brief."""
    try:
        brief_id = _bounded_text(brief_id, label="brief_id", maximum=160)
        query = _bounded_text(query, label="query", maximum=300)
    except ValueError as exc:
        return error("invalid_query", str(exc), category="validation", retryable=False)
    try:
        data = web_client.search_verified_publications(query=query, limit=max(1, min(int(limit), 10)))
        publications = list(data.get("publications") or [])
        items = [
            evidence("harmonia_verified_publication", provenance="live", reference=str(item["canonicalUrl"]))
            for item in publications
        ]
        return success(
            {"briefId": brief_id, "query": query, "publications": publications, "count": len(publications)},
            evidence_items=items,
        )
    except Exception as exc:  # noqa: BLE001 - normalized read-only tool boundary
        return provider_error(exc)


_NONI_TOOL_CONTRACTS = {
    "search_verified_publications": ToolContract(
        name="search_verified_publications",
        purpose="Read independently verified prior publications in the active workspace for internal linking.",
        input_schema={"brief_id": "exact active brief id", "query": "non-empty string", "limit": "integer 1..10"},
        return_schema="ToolEnvelope containing verified publications and canonical URLs",
        error_codes=("invalid_query", "authorization_failed", "dependency_unavailable", "provider_request_rejected", "tool_execution_failed"),
        permission="read", data_scope="workspace", timeout_seconds=30,
        retry="one_transient_retry", external_effect=False, skill_names=(NONI_SKILL_NAME,),
    ),
}


def validate_noni_tool_contracts() -> dict[str, ToolContract]:
    return dict(_NONI_TOOL_CONTRACTS)


def build_noni_writing_skillset() -> skill_toolset.SkillToolset:
    """Expose one filesystem skill and only its two read-only loading tools."""
    skill = load_skill_from_dir(NONI_SKILL_ROOT)
    if skill.frontmatter.name != NONI_SKILL_NAME:
        raise RuntimeError("Noni writing skill name does not match its runtime contract")
    return skill_toolset.SkillToolset(
        skills=[skill],
        additional_tools=[FunctionTool(search_verified_publications)],
        tool_filter=["load_skill", "load_skill_resource", "search_verified_publications"],
    )


def compiled_noni_artifact_skill_context() -> str:
    """Compile the approved static writing method without spending model turns."""
    skill = load_skill_from_dir(NONI_SKILL_ROOT)
    references = []
    for path in NONI_ARTIFACT_REFERENCES:
        name = path.removeprefix("references/")
        content = skill.resources.references.get(name)
        if not content:
            raise RuntimeError(f"Noni compiled reference is missing: {path}")
        references.append(f"APPROVED REFERENCE {path}:\n{content}")
    return f"APPROVED SKILL {NONI_SKILL_NAME}:\n{skill.instructions}\n\n" + "\n\n".join(references)


def activate_noni_artifact_skill(callback_context: Context) -> None:
    """Record the coordinator-side activation of the compiled, immutable skill."""
    callback_context.state[NONI_SKILL_TRACE_KEY] = skill_activation_records(
        skill_name=NONI_SKILL_NAME,
        skill_root=NONI_SKILL_ROOT,
        references=NONI_ARTIFACT_REFERENCES,
    )


class GroundedWebSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidenceId: str = Field(pattern=r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$")
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(min_length=8, max_length=2_000)
    supportedText: str = Field(min_length=1, max_length=1_000)

    @field_validator("url")
    @classmethod
    def require_public_url(cls, value: str) -> str:
        if not value.startswith(("https://", "http://")):
            raise ValueError("grounded source URL must be public HTTP(S)")
        return value


class GroundedWebResearch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    briefId: str = Field(min_length=1, max_length=160)
    query: str = Field(min_length=1, max_length=300)
    sources: list[GroundedWebSource] = Field(min_length=1, max_length=8)


def build_noni_web_search_tool(model: str | BaseLlm) -> MetaWebSearchTool:
    """Run Meta web search in its own request, apart from Noni's skill tools."""
    return MetaWebSearchTool(
        name=NONI_SEARCH_TOOL,
        description="Meta web search grounding for one exact Noni content brief.",
        instructions=(
            "Search the web only for the exact brief ID and research question in the request. "
            "Prefer primary sources. Return strict GroundedWebResearch JSON. Assign stable source "
            "labels such as web-1 and, for each source, the exact title and URL of a search result "
            "plus supportedText copied verbatim from that result. Never change strategy, authorize "
            "an action, or use private data."
        ),
        output_model=GroundedWebResearch,
        model_id=search_model_id(model),
    )


def reset_noni_skill_trace(callback_context: Context) -> None:
    callback_context.state[NONI_SKILL_TRACE_KEY] = []


def record_noni_skill_tool(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: Context,
    tool_response: dict[str, Any],
) -> None:
    if tool.name == "set_model_response":
        return
    trace = list(tool_context.state.get(NONI_SKILL_TRACE_KEY) or [])
    entry = {
        "sequence": len(trace) + 1,
        "name": tool.name,
        "args": dict(args),
    }
    if tool.name in NONI_RESEARCH_TOOLS:
        entry["response"] = tool_response
    trace.append(entry)
    tool_context.state[NONI_SKILL_TRACE_KEY] = trace


def _skill_name(entry: dict[str, Any]) -> str | None:
    args = entry.get("args") or {}
    value = args.get("skill_name") or args.get("name")
    return value if isinstance(value, str) else None


def _resource_path(entry: dict[str, Any]) -> str | None:
    args = entry.get("args") or {}
    value = args.get("file_path")
    return value if isinstance(value, str) else None


def _source_fields_for_reference(value: Any, reference: str) -> tuple[str, ...]:
    matches: list[str] = []
    pending = [value]
    while pending:
        current = pending.pop()
        if isinstance(current, dict):
            strings = [item for item in current.values() if isinstance(item, str)]
            if reference in strings:
                matches.extend(strings)
            pending.extend(current.values())
        elif isinstance(current, list):
            pending.extend(current)
    return tuple(dict.fromkeys([*matches, reference]))


def _research_terms(value: str) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9]+", value.lower())
        if len(token) >= 3 and token not in _RESEARCH_STOP_WORDS
    }


def validate_noni_skill_trace(
    trace: list[dict[str, Any]], *, brief_id: str | None = None,
    brief_text: str | None = None,
) -> dict[str, tuple[str, ...]]:
    """Fail closed unless Noni used only the exact writing skill and references."""
    if trace and trace[0].get("kind") == "skill_activation":
        validate_skill_activation(
            trace, skill_name=NONI_SKILL_NAME, skill_root=NONI_SKILL_ROOT,
            allowed_references=NONI_SKILL_REFERENCES,
        )
        return {}
    if (
        not trace
        or trace[0].get("name") != "load_skill"
        or sum(item.get("name") == "load_skill" for item in trace) != 1
    ):
        raise ValueError("Noni must load noni-writing-skills exactly once first")
    if [item.get("sequence") for item in trace] != list(range(1, len(trace) + 1)):
        raise ValueError("Noni writing-skill trace sequence is invalid")
    if _skill_name(trace[0]) != NONI_SKILL_NAME:
        raise ValueError("Noni may load only noni-writing-skills")

    resource_paths: list[str] = []
    research_evidence: dict[str, tuple[str, ...]] = {}
    research_started = False
    for item in trace[1:]:
        name = item.get("name")
        if name == "load_skill_resource":
            if research_started:
                raise ValueError("Noni must load writing references before research tools")
            if _skill_name(item) != NONI_SKILL_NAME:
                raise ValueError("Noni may load resources only from noni-writing-skills")
            path = _resource_path(item)
            if path not in NONI_SKILL_REFERENCES:
                raise ValueError(f"Noni loaded an unapproved resource: {path}")
            resource_paths.append(path)
            continue
        if name not in NONI_RESEARCH_TOOLS:
            raise ValueError(f"Noni used a prohibited tool: {item.get('name')}")
        research_started = True
        args = item.get("args") or {}
        if name == NONI_SEARCH_TOOL:
            raw_response, provenance = search_response(item.get("response"), label="Noni")
            try:
                result = GroundedWebResearch.model_validate(raw_response)
            except ValueError as exc:
                raise ValueError("Noni web search result requires structured provenance") from exc
            if brief_id is None or result.briefId != brief_id:
                raise ValueError("Noni research must bind to the exact brief")
            research_text = " ".join((str(args.get("request") or ""), result.query))
            if not brief_text or not (_research_terms(research_text) & _research_terms(brief_text)):
                raise ValueError("Noni research query is outside the active brief")
            for source in result.sources:
                require_cited_source(
                    provenance, url=source.url, title=source.title,
                    supported_text=source.supportedText, label="Noni",
                )
                if source.evidenceId in research_evidence:
                    raise ValueError("Noni research returned duplicate evidence")
                research_evidence[source.evidenceId] = (source.supportedText, source.title, source.url)
            continue

        if brief_id is None or args.get("brief_id") != brief_id:
            raise ValueError("Noni research must bind to the exact brief")
        research_text = str(args.get("query") or "")
        if not brief_text or not (_research_terms(research_text) & _research_terms(brief_text)):
            raise ValueError("Noni research query is outside the active brief")
        response = validate_tool_envelope(item.get("response") or {})
        if response.status != "success" or not response.evidence:
            raise ValueError("Noni research result requires live provenance")
        for item_evidence in response.evidence:
            if item_evidence.provenance != "live" or not item_evidence.reference:
                raise ValueError("Noni research result requires live provenance")
            if item_evidence.evidenceId in research_evidence:
                raise ValueError("Noni research returned duplicate evidence")
            research_evidence[item_evidence.evidenceId] = _source_fields_for_reference(
                response.data, item_evidence.reference,
            )
    if not resource_paths:
        raise ValueError("Noni must load at least one writing reference")
    if len(resource_paths) != len(set(resource_paths)):
        raise ValueError("Noni loaded a duplicate writing reference")
    return research_evidence
