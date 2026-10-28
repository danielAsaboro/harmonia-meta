"""Request-bound web research tool for Nimi, separate from filesystem skills."""

from __future__ import annotations

import json
import re
from typing import Any

from google.adk.agents.context import Context
from google.adk.models.base_llm import BaseLlm
from google.adk.tools.base_tool import BaseTool
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .meta_search import MetaWebSearchTool, require_cited_source, search_model_id, search_response

NIMI_RESEARCH_TRACE_KEY = "nimi_analysis_research_trace"
NIMI_SEARCH_TOOL = "nimi_web_search"


class GroundedAnalysisSource(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidenceId: str = Field(pattern=r"^analysis-search-[A-Za-z0-9][A-Za-z0-9._:-]{0,82}$")
    title: str = Field(min_length=1, max_length=300)
    url: str = Field(min_length=8, max_length=2_000)
    supportedText: str = Field(min_length=1, max_length=1_000)

    @field_validator("url")
    @classmethod
    def require_public_url(cls, value: str) -> str:
        if not value.startswith(("https://", "http://")):
            raise ValueError("grounded source URL must be public HTTP(S)")
        return value


class GroundedAnalysisResearch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    requestId: str = Field(min_length=1, max_length=100)
    query: str = Field(min_length=1, max_length=500)
    sources: list[GroundedAnalysisSource] = Field(min_length=1, max_length=8)


def build_nimi_web_search_tool(model: str | BaseLlm) -> MetaWebSearchTool:
    return MetaWebSearchTool(
        name=NIMI_SEARCH_TOOL,
        description="Meta web search grounding for one exact Nimi analysis research request.",
        instructions=(
            "Search the web only for the exact typed request. Return strict "
            "GroundedAnalysisResearch JSON with the unchanged requestId, actual query, stable "
            "analysis-search-* evidence IDs, and for each source the exact title and URL of a "
            "search result plus supportedText copied verbatim from that result. Do not analyze "
            "source media, invent research, define strategy, or authorize actions."
        ),
        output_model=GroundedAnalysisResearch,
        model_id=search_model_id(model),
    )


def reset_nimi_research_trace(callback_context: Context) -> None:
    callback_context.state[NIMI_RESEARCH_TRACE_KEY] = []


def is_nimi_research_tool(tool: BaseTool) -> bool:
    return tool.name == NIMI_SEARCH_TOOL


def guard_nimi_research_tool(tool: BaseTool) -> None:
    if not is_nimi_research_tool(tool):
        raise ValueError(f"Nimi used a prohibited research tool: {tool.name}")


def record_nimi_research_tool(tool: BaseTool, args: dict[str, Any], tool_context: Context, tool_response: dict[str, Any]) -> None:
    trace = list(tool_context.state.get(NIMI_RESEARCH_TRACE_KEY) or [])
    trace.append({"sequence": len(trace) + 1, "name": tool.name, "args": dict(args), "response": tool_response})
    tool_context.state[NIMI_RESEARCH_TRACE_KEY] = trace


def _typed(value: Any) -> Any:
    return value.model_dump(mode="json") if hasattr(value, "model_dump") else value


def validate_nimi_research_trace(
    trace: list[dict[str, Any]], *, research_request: Any | None,
) -> dict[str, tuple[str, ...]]:
    if research_request is None:
        if trace:
            raise ValueError("Nimi searched without a supplied analysis research request")
        return {}
    request = _typed(research_request)
    if not isinstance(request, dict) or len(trace) != 1 or trace[0].get("sequence") != 1:
        raise ValueError("Nimi must execute exactly one request-bound web search")
    call = trace[0]
    if call.get("name") != NIMI_SEARCH_TOOL:
        raise ValueError("Nimi used a prohibited research tool for the analysis request")
    call_request = (call.get("args") or {}).get("request")
    if isinstance(call_request, str):
        try:
            call_request = json.loads(call_request)
        except json.JSONDecodeError as exc:
            raise ValueError("Nimi search request must be exact typed JSON") from exc
    if call_request != request:
        raise ValueError("Nimi search must use the exact analysis research request")
    raw, provenance = search_response(call.get("response"), label="Nimi")
    try:
        result = GroundedAnalysisResearch.model_validate(raw)
    except ValueError as exc:
        raise ValueError("Nimi web search requires structured provenance") from exc
    if result.requestId != request.get("id"):
        raise ValueError("Nimi search must bind to the exact analysis research request")
    request_terms = set(re.findall(r"[a-z0-9]+", str(request.get("question") or "").lower()))
    query_terms = set(re.findall(r"[a-z0-9]+", result.query.lower()))
    if not {term for term in request_terms if len(term) > 3}.intersection(query_terms):
        raise ValueError("Nimi search query is outside the analysis research request")
    evidence: dict[str, tuple[str, ...]] = {}
    for source in result.sources:
        require_cited_source(
            provenance, url=source.url, title=source.title,
            supported_text=source.supportedText, label="Nimi",
        )
        if source.evidenceId in evidence:
            raise ValueError("Nimi search returned duplicate evidence")
        evidence[source.evidenceId] = (source.supportedText, source.title, source.url)
    return evidence
