"""Skill-backed operator insight tools for the Harmonia ADK team.

Loads the filesystem skills in ``harmonia_agent/skills`` into one
``SkillToolset`` whose additional function tools are real data paths only:
the official Hacker News Algolia API and Harmonia's own authenticated web
internal API. No tool here can publish, approve, or mutate anything.
"""

from __future__ import annotations

import pathlib
from collections import defaultdict
from datetime import datetime
from typing import Any

from google.adk.skills import load_skill_from_dir
from google.adk.tools import FunctionTool, skill_toolset

from . import signals, web_client
from .telemetry import safe_attributes, tracer
from .tool_contracts import ToolContract, error, evidence, provider_error, success

SKILLS_DIR = pathlib.Path(__file__).parent / "skills"

_SKILL_NAMES = (
    "trend-scan",
    "job-status",
    "signal-watch",
    "posting-schedule",
    "engagement-insights",
)


# ---------- trend / watch tools ----------

def fetch_trend_signals(limit: int = 6) -> dict[str, Any]:
    """Fetch current front-page startup-tech stories from Hacker News."""
    try:
        with tracer().start_as_current_span("harmonia.skill.fetch_signals"):
            found = signals.fetch_signals(limit=max(1, min(int(limit), 10)))
        provenance = "live"
        items = [evidence("hacker_news_algolia", provenance=provenance)]
        items.extend(evidence("hacker_news_story", provenance=provenance, reference=item["url"]) for item in found)
        return success({"signals": found, "count": len(found)}, evidence_items=items)
    except Exception as exc:  # noqa: BLE001 - normalized tool boundary
        return provider_error(exc)


def search_trend_signals(query: str, limit: int = 5) -> dict[str, Any]:
    """Search recent Hacker News stories for a topic or keyword."""
    normalized = (query or "").strip()
    if not normalized:
        return error("invalid_query", "Provide a non-empty trend query.", category="validation", retryable=False)
    try:
        with tracer().start_as_current_span("harmonia.skill.search_signals") as span:
            span.set_attributes(safe_attributes({"query.length": len(normalized)}))
            found = signals.search_signals(normalized, limit=max(1, min(int(limit), 10)))
        provenance = "live"
        items = [evidence("hacker_news_algolia", provenance=provenance)]
        items.extend(evidence("hacker_news_story", provenance=provenance, reference=item["url"]) for item in found)
        return success({"query": normalized, "signals": found, "count": len(found)}, evidence_items=items)
    except Exception as exc:  # noqa: BLE001
        return provider_error(exc)


def _engagement_data() -> tuple[dict[str, Any], str]:
    data = web_client.get_insights()
    return {"topPosts": list(data.get("topPosts") or []), **{k: v for k, v in data.items() if k != "topPosts"}}, "live"


def _feed_data() -> tuple[dict[str, Any], str]:
    return web_client.get_feed(), "live"


# ---------- harmonia-state read tools ----------

def get_engagement_insights() -> dict[str, Any]:
    """Read measured engagement outcomes for this workspace's published posts."""
    try:
        data, provenance = _engagement_data()
        items = [evidence("harmonia_firestore_engagement", provenance=provenance)]
        items.extend(
            evidence("harmonia_measured_post", provenance=provenance, reference=str(post["postId"]))
            for post in data.get("topPosts") or [] if post.get("postId")
        )
        return success(data, evidence_items=items)
    except Exception as exc:  # noqa: BLE001
        return provider_error(exc)


def get_operator_feed() -> dict[str, Any]:
    """Read the workspace feed: pending items, job health, goals, recent posts."""
    try:
        data, provenance = _feed_data()
        return success(data, evidence_items=[evidence("harmonia_firestore_feed", provenance=provenance)])
    except Exception as exc:  # noqa: BLE001
        return provider_error(exc)


_JOB_STATUS_FIELDS = (
    "id", "stage", "status", "error", "createdAt", "updatedAt",
    "strategyApprovalState", "strategyRevision", "editorialPlanRevision",
    "selectedNextItemId",
)


def _summarize_job(job: dict[str, Any]) -> dict[str, Any]:
    summary = {field: job.get(field) for field in _JOB_STATUS_FIELDS}
    config = job.get("config") or {}; analysis = job.get("sourceAnalysis") or {}
    summary["title"] = analysis.get("summary") or f"Source bundle {str(config.get('sourceManifestId') or '')[:12]}"
    summary["sourceKind"] = "source_manifest"
    artifacts = job.get("contentArtifacts") or []
    actions = job.get("actions") or []
    verifications = job.get("verifications") or []
    receipts = job.get("receipts") or []
    summary["artifactCount"] = len(artifacts)
    summary["actions"] = [
        {
            "id": a.get("id"),
            "type": a.get("type"),
            "state": a.get("state"),
            "approvalState": a.get("approvalState"),
            "requiresApproval": a.get("requiresApproval"),
            "risk": a.get("risk"),
        }
        for a in actions
    ]
    summary["verificationSummary"] = [
        {
            "actionId": v.get("actionId"),
            "verified": bool(v.get("verified")),
        }
        for v in verifications
    ]
    summary["receiptCount"] = len(receipts)
    return summary


def get_job_status(job_id: str) -> dict[str, Any]:
    """Read the live pipeline state of one content job by id."""
    job_id = str(job_id or "").strip()
    if not job_id:
        return error("invalid_job_id", "Provide one job ID.", category="validation", retryable=False)
    try:
        job = web_client.get_job(job_id)
    except web_client.WebApiError as exc:
        if exc.status == 404:
            return error("job_not_found", "No job exists in this workspace with that ID.", category="not_found", retryable=False)
        return provider_error(exc)
    return success({"found": True, "job": _summarize_job(job)}, evidence_items=[evidence("harmonia_firestore_job", provenance="live", reference=job_id)])


# ---------- schedule derivation ----------

def _parse_ts(value: Any) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def suggest_posting_windows() -> dict[str, Any]:
    """Derive posting windows from this workspace's own measured post history.

    Returns windows only when at least three timestamped measured posts exist;
    otherwise returns an explicit insufficient-data result.
    """
    try:
        insights, _ = _engagement_data()
        feed, _ = _feed_data()
        provenance = "live"
    except Exception as exc:  # noqa: BLE001
        return provider_error(exc)

    samples: list[dict[str, Any]] = []
    for post in insights.get("topPosts") or []:
        ts = _parse_ts(post.get("publishedAt"))
        likes = post.get("likes")
        if ts is not None and isinstance(likes, int):
            samples.append({"at": ts, "likes": likes, "postId": post.get("postId")})
    if len(samples) < 3:
        for entry in feed.get("recentPublished") or []:
            ts = _parse_ts(entry.get("publishedAt"))
            if ts is not None and entry.get("postId") not in {s["postId"] for s in samples}:
                samples.append({"at": ts, "likes": None, "postId": entry.get("postId")})

    measured = [s for s in samples if s["likes"] is not None]
    if len(measured) < 3:
        return error("insufficient_measured_history", "At least three timestamped posts with measured engagement are required.", category="not_found", retryable=False)

    by_hour: dict[int, list[int]] = defaultdict(list)
    for s in measured:
        by_hour[s["at"].hour].append(s["likes"])
    ranked = sorted(
        ((hour, sum(likes) / len(likes)) for hour, likes in by_hour.items()),
        key=lambda item: (-item[1], item[0]),
    )
    top_hours = ranked[:2]
    data = {
        "windows": [
            {
                "hourUtc": hour,
                "window": f"{hour:02d}:00-{(hour + 1) % 24:02d}:00 UTC",
                "averageLikes": round(avg, 1),
                "sampleSize": len(by_hour[hour]),
            }
            for hour, avg in top_hours
        ],
        "insufficientData": False,
        "measuredPosts": len(measured),
        "confidence": "low" if len(measured) < 10 else "medium" if len(measured) < 30 else "high",
        "limitations": [
            f"Derived from {len(measured)} measured posts in this workspace.",
            "The ranking compares likes only and does not establish causality.",
        ],
        "basis": [
            {"postId": s["postId"], "hourUtc": s["at"].hour, "likes": s["likes"]}
            for s in measured
        ],
    }
    items = [evidence("harmonia_measured_post_history", provenance=provenance)]
    items.extend(
        evidence("harmonia_measured_post", provenance=provenance, reference=str(item["postId"]))
        for item in data["basis"] if item["postId"]
    )
    return success(data, evidence_items=items)


_TOOLS = (
    fetch_trend_signals,
    search_trend_signals,
    get_engagement_insights,
    get_operator_feed,
    get_job_status,
    suggest_posting_windows,
)

_TOOL_CONTRACTS = {
    "fetch_trend_signals": ToolContract(name="fetch_trend_signals", purpose="Read the current public startup technology story feed for bounded trend context.", input_schema={"limit": "integer 1..10"}, return_schema="ToolEnvelope containing signals and count", error_codes=("dependency_unavailable", "provider_request_rejected", "tool_execution_failed"), permission="read", data_scope="public", timeout_seconds=20, retry="one_transient_retry", external_effect=False, skill_names=("trend-scan", "signal-watch")),
    "search_trend_signals": ToolContract(name="search_trend_signals", purpose="Read recent public startup technology stories matching one operator query.", input_schema={"query": "non-empty string", "limit": "integer 1..10"}, return_schema="ToolEnvelope containing query, signals, and count", error_codes=("invalid_query", "dependency_unavailable", "provider_request_rejected", "tool_execution_failed"), permission="read", data_scope="public", timeout_seconds=20, retry="one_transient_retry", external_effect=False, skill_names=("trend-scan", "signal-watch")),
    "get_engagement_insights": ToolContract(name="get_engagement_insights", purpose="Read measured engagement outcomes already persisted for the active workspace.", input_schema={}, return_schema="ToolEnvelope containing measured top posts and takeaways", error_codes=("authorization_failed", "dependency_unavailable", "provider_request_rejected", "tool_execution_failed"), permission="read", data_scope="workspace", timeout_seconds=30, retry="one_transient_retry", external_effect=False, skill_names=("engagement-insights", "posting-schedule")),
    "get_operator_feed": ToolContract(name="get_operator_feed", purpose="Read pending items, job health, goals, and recent posts for the active workspace.", input_schema={}, return_schema="ToolEnvelope containing the scoped operator feed", error_codes=("authorization_failed", "dependency_unavailable", "provider_request_rejected", "tool_execution_failed"), permission="read", data_scope="workspace", timeout_seconds=30, retry="one_transient_retry", external_effect=False, skill_names=("signal-watch", "posting-schedule")),
    "get_job_status": ToolContract(name="get_job_status", purpose="Read a metadata-only summary of one job in the active workspace by identifier.", input_schema={"job_id": "non-empty workspace job id"}, return_schema="ToolEnvelope containing one redacted job summary", error_codes=("invalid_job_id", "job_not_found", "authorization_failed", "dependency_unavailable", "provider_request_rejected", "tool_execution_failed"), permission="read", data_scope="workspace", timeout_seconds=30, retry="one_transient_retry", external_effect=False, skill_names=("job-status",)),
    "suggest_posting_windows": ToolContract(name="suggest_posting_windows", purpose="Derive bounded UTC posting windows only from measured active-workspace history.", input_schema={}, return_schema="ToolEnvelope containing measured posting windows and evidence", error_codes=("insufficient_measured_history", "authorization_failed", "dependency_unavailable", "provider_request_rejected", "tool_execution_failed"), permission="read", data_scope="workspace", timeout_seconds=30, retry="one_transient_retry", external_effect=False, skill_names=("posting-schedule",)),
}


def validate_tool_contracts() -> dict[str, ToolContract]:
    """Fail closed when an exposed ADK tool lacks a least-privilege contract."""
    exposed = {tool.__name__ for tool in _TOOLS}
    registered = set(_TOOL_CONTRACTS)
    if exposed != registered:
        raise RuntimeError(f"tool contract mismatch: missing={sorted(exposed - registered)} extra={sorted(registered - exposed)}")
    for tool in _TOOLS:
        if not (tool.__doc__ or "").strip() or not tool.__annotations__.get("return"):
            raise RuntimeError(f"tool metadata incomplete: {tool.__name__}")
    runtime_codes = {"dependency_unavailable", "provider_request_rejected", "tool_execution_failed"}
    for name, contract in _TOOL_CONTRACTS.items():
        missing = runtime_codes - set(contract.error_codes)
        if missing:
            raise RuntimeError(f"tool contract {name} omits runtime error codes: {sorted(missing)}")
    return dict(_TOOL_CONTRACTS)


def build_insight_skillset() -> skill_toolset.SkillToolset:
    """One SkillToolset covering all Harmonia insight skills plus their tools."""
    validate_tool_contracts()
    skills = [load_skill_from_dir(SKILLS_DIR / name) for name in _SKILL_NAMES]
    return skill_toolset.SkillToolset(
        skills=skills,
        additional_tools=[FunctionTool(tool) for tool in _TOOLS],
    )
