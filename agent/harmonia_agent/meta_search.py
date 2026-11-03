"""Request-bound web research on Meta Model API's built-in ``web_search`` tool.

Search grounding runs only on the Responses API (docs/meta-model-api/search-grounding.md),
so research tools call ``POST /v1/responses`` directly instead of riding the
Chat Completions model binding. Each call returns the model's typed research and
provider-observed provenance: the ``web_search_call`` count, the raw search
``results`` (opt-in through ``include``), and the ``url_citation`` annotations.
Validators accept a model-cited source only when that provenance contains it.

The API key is read from the runtime environment on every call; tools hold no
credentials.
"""

from __future__ import annotations

import os
import re
from collections.abc import Iterable
from decimal import Decimal
from typing import Any, Literal

import httpx
from google.adk.models.base_llm import BaseLlm
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext
from google.genai import types
from pydantic import BaseModel, ConfigDict, Field, ValidationError

from . import meta_api
from .meta_llm import PROVIDER_ENDPOINTS
from .model_catalog import estimate_text_cost, estimate_web_search_cost
from .provider_schema import meta_output_schema
from .role_models import DEFAULT_META_MODEL

WEB_SEARCH_MAX_OUTPUT_TOKENS = 8192
WEB_SEARCH_TIMEOUT_SECONDS = 120
# The model decides how many searches one request runs; Meta exposes no cap on
# the Responses API, so budgets reserve this many billed queries per tool call.
WEB_SEARCH_RESERVED_QUERIES = 5
# Retrieved search context arrives as input tokens; reserve for a full context.
WEB_SEARCH_RESERVED_INPUT_TOKENS = 32_000
_MAX_RESULTS = 20
_MAX_SNIPPET_CHARS = 2_000


class MetaWebSearchError(RuntimeError):
    """Meta Model API rejected or failed one web search research request."""

    def __init__(self, message: str, *, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status


class WebSearchResult(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2_000)
    title: str = Field(max_length=500)
    snippet: str = Field(max_length=_MAX_SNIPPET_CHARS)


class WebSearchCitation(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: str = Field(min_length=1, max_length=2_000)
    title: str = Field(max_length=500)
    citedText: str


class WebSearchProvenance(BaseModel):
    """Provider-observed evidence for one Responses API web search request."""

    model_config = ConfigDict(extra="forbid")
    provider: Literal["meta"] = "meta"
    responseId: str = Field(min_length=1, max_length=200)
    model: str = Field(min_length=1, max_length=200)
    searchCalls: int = Field(ge=0)
    results: list[WebSearchResult] = Field(max_length=_MAX_RESULTS)
    citations: list[WebSearchCitation]
    inputTokens: int = Field(ge=0)
    outputTokens: int = Field(ge=0)


def search_model_id(model: str | BaseLlm) -> str:
    """Return the Meta catalog model that runs a role's web search.

    ``web_search`` exists only on Meta Model API, so a role served from Baseten
    searches with Meta's default Muse Spark model.
    """
    if getattr(model, "provider", "meta") != "meta":
        return DEFAULT_META_MODEL
    return (model if isinstance(model, str) else model.model).removeprefix("openai/")


def _endpoint() -> tuple[str, str]:
    base_env, default_base, key_env = PROVIDER_ENDPOINTS["meta"]
    key = os.environ.get(key_env)
    if not key:
        raise RuntimeError(f"missing required environment variable: {key_env}")
    return os.environ.get(base_env, default_base).rstrip("/"), key


def _http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=WEB_SEARCH_TIMEOUT_SECONDS, transport=meta_api.AsyncRetryTransport())


def _provenance(body: dict[str, Any], *, model_id: str) -> tuple[str, WebSearchProvenance]:
    search_calls = 0
    results: list[WebSearchResult] = []
    citations: list[WebSearchCitation] = []
    texts: list[str] = []
    for item in body.get("output") or []:
        if not isinstance(item, dict):
            continue
        if item.get("type") == "web_search_call":
            if item.get("status") == "completed":
                search_calls += 1
            for hit in item.get("results") or []:
                if isinstance(hit, dict) and isinstance(hit.get("url"), str) and len(results) < _MAX_RESULTS:
                    results.append(WebSearchResult(
                        url=hit["url"],
                        title=str(hit.get("title") or "")[:500],
                        snippet=str(hit.get("snippet") or "")[:_MAX_SNIPPET_CHARS],
                    ))
        elif item.get("type") == "message":
            for block in item.get("content") or []:
                if not isinstance(block, dict) or block.get("type") != "output_text":
                    continue
                text = str(block.get("text") or "")
                texts.append(text)
                for annotation in block.get("annotations") or []:
                    if not isinstance(annotation, dict) or annotation.get("type") != "url_citation":
                        continue
                    if not isinstance(annotation.get("url"), str):
                        continue
                    start, end = annotation.get("start_index"), annotation.get("end_index")
                    cited = text[start:end] if isinstance(start, int) and isinstance(end, int) else ""
                    citations.append(WebSearchCitation(
                        url=annotation["url"],
                        title=str(annotation.get("title") or "")[:500],
                        citedText=cited,
                    ))
    usage = body.get("usage") if isinstance(body.get("usage"), dict) else {}
    return "".join(texts), WebSearchProvenance(
        responseId=str(body.get("id") or ""),
        model=model_id,
        searchCalls=search_calls,
        results=results,
        citations=citations,
        inputTokens=int(usage.get("input_tokens") or 0),
        outputTokens=int(usage.get("output_tokens") or 0),
    )


async def run_web_search(
    *, model_id: str, instructions: str, request: str, output_model: type[BaseModel],
) -> tuple[BaseModel, WebSearchProvenance]:
    """Run one search-grounded Responses request with a typed research result."""
    api_base, api_key = _endpoint()
    payload = {
        "model": model_id,
        "instructions": instructions,
        "input": request,
        "tools": [{"type": "web_search"}],
        "include": ["web_search_call.results"],
        "text": {"format": {
            "type": "json_schema",
            "name": output_model.__name__,
            "schema": meta_output_schema(output_model),
            "strict": True,
        }},
        "max_output_tokens": WEB_SEARCH_MAX_OUTPUT_TOKENS,
        "store": False,
    }
    async with _http_client() as client:
        try:
            response = await client.post(
                f"{api_base}/responses",
                json=payload,
                headers={"Authorization": f"Bearer {api_key}"},
            )
        except httpx.HTTPError as exc:
            raise MetaWebSearchError(f"web search request failed: {type(exc).__name__}") from exc
    if response.status_code >= 400:
        raise MetaWebSearchError(
            f"web search request rejected with HTTP {response.status_code}",
            status=response.status_code,
        )
    try:
        body = response.json()
    except ValueError as exc:
        raise MetaWebSearchError("web search returned a non-JSON response") from exc
    if not isinstance(body, dict) or body.get("status") != "completed":
        status = body.get("status") if isinstance(body, dict) else None
        raise MetaWebSearchError(f"web search response did not complete: {status}")
    text, provenance = _provenance(body, model_id=model_id)
    if not provenance.responseId:
        raise MetaWebSearchError("web search response has no id")
    try:
        research = output_model.model_validate_json(text)
    except ValidationError as exc:
        raise MetaWebSearchError("web search returned invalid structured research") from exc
    return research, provenance


class MetaWebSearchTool(BaseTool):
    """One request-bound research function backed by Meta's ``web_search``."""

    def __init__(
        self, *, name: str, description: str, instructions: str,
        output_model: type[BaseModel], model_id: str,
    ) -> None:
        super().__init__(name=name, description=description)
        self.instructions = instructions
        self.output_model = output_model
        self.model_id = model_id

    def _get_declaration(self) -> types.FunctionDeclaration:
        return types.FunctionDeclaration(
            name=self.name,
            description=self.description,
            parameters=types.Schema(
                type=types.Type.OBJECT,
                properties={"request": types.Schema(
                    type=types.Type.STRING,
                    description="The exact research request to execute.",
                )},
                required=["request"],
            ),
        )

    async def run_async(self, *, args: dict[str, Any], tool_context: ToolContext) -> dict[str, Any]:
        request = args.get("request")
        if not isinstance(request, str) or not request.strip():
            raise ValueError(f"{self.name} requires a non-empty request")
        research, provenance = await run_web_search(
            model_id=self.model_id, instructions=self.instructions,
            request=request, output_model=self.output_model,
        )
        return {
            "research": research.model_dump(mode="json"),
            "provenance": provenance.model_dump(mode="json"),
        }


def search_response(raw: Any, *, label: str) -> tuple[Any, WebSearchProvenance]:
    """Split one recorded tool response into its research and validated provenance."""
    if not isinstance(raw, dict) or "research" not in raw or "provenance" not in raw:
        raise ValueError(f"{label} web search requires recorded research and provenance")
    try:
        provenance = WebSearchProvenance.model_validate(raw["provenance"])
    except ValidationError as exc:
        raise ValueError(f"{label} web search provenance is invalid") from exc
    if provenance.searchCalls < 1:
        raise ValueError(f"{label} web search returned no completed search")
    return raw["research"], provenance


def _normalized(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def require_cited_source(
    provenance: WebSearchProvenance, *, url: str, title: str, supported_text: str, label: str,
) -> None:
    """Fail closed unless Meta's results or citations contain the cited source."""
    items = [
        (item.title, item.snippet) for item in provenance.results if item.url == url
    ] + [
        (item.title, item.citedText) for item in provenance.citations if item.url == url
    ]
    titled = any(_normalized(item_title) == _normalized(title) for item_title, _ in items)
    supported = any(_normalized(supported_text) in _normalized(text) for _, text in items)
    if not titled or not supported:
        raise ValueError(f"{label} source is absent from web search provenance")


def provenance_from_trace(trace: Iterable[dict[str, Any]], tool_name: str) -> dict[str, Any] | None:
    """Return the provenance recorded for a single-search role, if it searched."""
    for item in trace:
        response = item.get("response") if isinstance(item, dict) else None
        if item.get("name") == tool_name and isinstance(response, dict):
            provenance = response.get("provenance")
            return provenance if isinstance(provenance, dict) else None
    return None


def web_search_spend(provenances: Iterable[dict[str, Any]]) -> Decimal:
    """Observed cost of recorded searches: tokens plus $2.50 per 1,000 queries."""
    total = Decimal("0")
    for raw in provenances:
        provenance = WebSearchProvenance.model_validate(raw)
        total += estimate_text_cost(provenance.model, provenance.inputTokens, provenance.outputTokens)
        total += estimate_web_search_cost(provenance.searchCalls)
    return total


def web_search_reservation(model_id: str) -> Decimal:
    """Conservative pre-dispatch reservation for one web search tool call."""
    return estimate_text_cost(
        model_id, WEB_SEARCH_RESERVED_INPUT_TOKENS, WEB_SEARCH_MAX_OUTPUT_TOKENS,
    ) + estimate_web_search_cost(WEB_SEARCH_RESERVED_QUERIES)
