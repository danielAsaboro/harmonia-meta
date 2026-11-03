"""Recorded Meta web search tool responses for research-trace tests."""

from __future__ import annotations

from typing import Any


def search_provenance(*sources: dict[str, Any], search_calls: int = 1) -> dict[str, Any]:
    """Provenance whose raw results contain each model-cited source verbatim."""
    return {
        "provider": "meta",
        "responseId": "resp_test",
        "model": "muse-spark-1.3",
        "searchCalls": search_calls,
        "results": [
            {"url": source["url"], "title": source["title"], "snippet": f"Context. {source['supportedText']} More."}
            for source in sources
        ],
        "citations": [],
        "inputTokens": 1200,
        "outputTokens": 300,
    }


def search_tool_response(research: dict[str, Any], **kwargs: Any) -> dict[str, Any]:
    return {"research": research, "provenance": search_provenance(*research["sources"], **kwargs)}
