"""Harmonia stage handlers for source collection through verified effects."""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
import uuid
import secrets
import struct
from contextvars import ContextVar
from pathlib import Path
import asyncio
import math
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable

import httpx
from opentelemetry.trace import Status, StatusCode
from pydantic import ValidationError

from . import clipper, content, x_client, youtube
from .linkedin_client import LinkedInClient
from .agent_models import (
    SourceAnalysis,
    AnalystInput,
    AnalystPerformanceObservation,
    CampaignContext,
    CompanyContext,
    CopywriterInput,
    DraftWorkflowResult,
    EditorialPlan,
    EditorialPlannerInput,
    PerformanceObservation,
    StrategistInput,
)
from .content_artifacts import ArtifactProductionInput, ContentArtifactRecord
from .artifact_export import ArtifactVerificationError, verify_content_artifact_export
from .agents import (
    AgentProtocolError,
    analyze_with_team,
    configured_memory,
    draft_with_team,
    produce_artifacts_with_team,
    plan_with_team,
    prepare_strategist_input,
    strategize_with_team,
    validate_source_analysis,
)
from .config import settings
from .memory_bank import (
    MemoryProtocolError,
    MemoryProviderError,
    eligible_job_memories,
)
from .failures import FailureCategory, FailureEnvelope, normalize_failure
from .team_runtime import AgentEngineProtocolError, AgentEngineProviderError
from .telemetry import current_trace_id, inject_context, safe_attributes, tracer
from .usage import InvocationContext
from .effect_executor import execute_effect_command, production_adapters
from .extraction import extract_docx, extract_html, extract_media, extract_pdf, extract_text
from .extraction.security import assert_public_url
from .operation_context import current_operation, operation_scope
from .web_client import (
    EffectClaimInProgress,
    EffectClaimUncertain,
    WebApiError,
    claim_effect,
    claim_stage_execution,
    finalize_stage_execution,
    get_asset,
    get_connection,
    get_effect_commands,
    get_editorial_planning_snapshot,
    get_insights,
    get_job,
    get_source,
    get_source_manifest,
    get_chat_attachment,
    get_content_artifact,
    read_artifact,
    post as web_post,
    patch as web_patch,
    report_usage,
    transition_effect_command,
    web_post_raw_asset,
)

logger = logging.getLogger("harmonia.stages")
Handler = Callable[[str], Awaitable[None]]
_ACTIVE_STAGE_OPERATION_ID: ContextVar[str | None] = ContextVar(
    "harmonia_active_stage_operation_id", default=None,
)


def _invocation_operation_id(legacy_operation_id: str, active_suffix: str | None = None) -> str:
    """Bind model accounting to the durable stage generation when dispatched."""
    active = _ACTIVE_STAGE_OPERATION_ID.get()
    if active is not None:
        return f"{active}:{active_suffix}" if active_suffix else active
    fence = current_operation()
    return fence.operation_id if fence is not None else legacy_operation_id


class ClipRenderError(RuntimeError):
    pass


def _canonical_typed_bytes(value: Any) -> str:
    """Typed canonical encoding with IEEE-754 numbers shared with TypeScript."""
    if value is None:
        return "n;"
    if isinstance(value, bool):
        return "b1;" if value else "b0;"
    if isinstance(value, (int, float)):
        numeric = float(value)
        if not math.isfinite(numeric):
            raise ValueError("typed digest requires finite numbers")
        if numeric == 0:
            numeric = 0.0
        return f"d{struct.pack('>d', numeric).hex()};"
    if isinstance(value, str):
        return f"s{len(value.encode('utf-8'))}:{value}"
    if isinstance(value, list):
        return f"a{len(value)}[{''.join(_canonical_typed_bytes(item) for item in value)}]"
    if isinstance(value, dict):
        entries = "".join(
            _canonical_typed_bytes(key) + _canonical_typed_bytes(value[key])
            for key in sorted(value)
        )
        return f"o{len(value)}{{{entries}}}"
    raise ValueError("typed digest contains an unsupported value")


def editorial_plan_digest(plan: dict[str, Any]) -> str:
    """Canonical SHA-256 over typed values and IEEE-754 numeric bits."""
    encoded = _canonical_typed_bytes(plan)
    return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def _source_analysis_items(job: dict[str, Any], field: str) -> list[dict[str, Any]]:
    """Read persisted analysis artifacts from their canonical job envelope."""
    analysis = job.get("sourceAnalysis")
    if not isinstance(analysis, dict):
        return []
    items = analysis.get(field)
    if not isinstance(items, list):
        return []
    return [item for item in items if isinstance(item, dict)]


def _source_moments(job: dict[str, Any]) -> list[dict[str, Any]]:
    return _source_analysis_items(job, "moments")


def _source_angles(job: dict[str, Any]) -> list[dict[str, Any]]:
    return _source_analysis_items(job, "angles")


def _meme_angles(job: dict[str, Any]) -> list[dict[str, Any]]:
    return [angle for angle in _source_angles(job) if angle.get("angleType") == "meme"]


def deterministic_generative_media_actions(job: dict[str, Any]) -> list[dict[str, Any]]:
    """Propose bounded paid media from validated analysis, outside the planner."""
    title = str((job.get("sourceAnalysis") or {}).get("summary") or "startup launch")[:200]
    moments = [
        item for item in _source_moments(job)
        if item.get("id") and item.get("visualHook")
    ]
    angles = [item for item in _source_angles(job) if item.get("id")]
    actions: list[dict[str, Any]] = []
    if moments:
        moment = moments[0]
        prompt = (
            f"Vertical cinematic b-roll for {title}. Visual beat: {str(moment['visualHook'])[:500]}. "
            "Abstract product motion, no people, no logos, no text, no dialogue, silent output."
        )
        digest = hashlib.sha256(f"veo|{moment['id']}|{prompt}".encode()).hexdigest()[:12]
        actions.append({
            "id": f"act-veo-{digest}",
            "type": "generate_video",
            "title": f"Generate Veo video: {str(moment.get('title') or title)[:36]}",
            "description": "Generate one 4-second 720p vertical video asset with Veo 3.1 Fast (estimated $0.32).",
            "momentId": moment["id"],
            "payload": {
                "type": "generate_video", "modelCapability": "veo-3.1-fast",
                "mode": "text_to_video", "prompt": prompt, "durationSec": 4,
                "aspectRatio": "9:16", "resolution": "720p", "generateAudio": False,
                "enhancePrompt": True, "outputCount": 1,
            },
        })
    angle = angles[0] if angles else None
    music_concept = str(angle.get("title")) if angle else title
    prompt = (
        f"Instrumental 30-second soundtrack for a startup social clip about {music_concept}. "
        "Optimistic, modern, focused, no vocals, clean ending."
    )
    digest = hashlib.sha256(f"lyria|{music_concept}|{prompt}".encode()).hexdigest()[:12]
    actions.append({
        "id": f"act-lyria-{digest}",
        "type": "generate_music",
        "title": f"Generate Lyria soundtrack: {music_concept[:34]}",
        "description": "Generate one 30-second instrumental clip with Lyria 3; deployment pricing must be configured before approval.",
        **({"angleId": angle["id"]} if angle else {}),
        "payload": {
            "type": "generate_music", "modelCapability": "lyria-3-clip", "prompt": prompt,
            "instrumental": True, "lyricsMode": "none", "language": "en",
            "targetDurationSec": 30, "outputCount": 1,
        },
    })
    return actions


def _segments_in_window(job_id: str, start: float, end: float) -> list[dict[str, Any]]:
    """Timed normalized segments overlapping [start,end], for caption burning."""
    result = []
    for source in get_source_manifest(job_id).get("normalizedSources") or []:
        for segment in source.get("segments") or []:
            locator = segment.get("locator") or {}
            if locator.get("kind") != "time_range": continue
            start_sec, end_sec = float(locator["startMs"]) / 1000, float(locator["endMs"]) / 1000
            if end_sec > start and start_sec < end:
                result.append({"id": f"{source['sourceId']}:{segment['id']}", "startSec": start_sec, "endSec": end_sec, "text": segment["text"]})
    return result


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _materialize_source_video(job_id: str, moment: dict[str, Any], directory: str) -> Path:
    refs = moment.get("sourceSegmentRefs") or []
    source_id = str(refs[0]).split(":", 1)[0] if refs else ""
    if not source_id: raise ClipRenderError("clip moment has no source evidence")
    source_package = get_source(source_id); source_input = (source_package.get("payload") or {}).get("input") or {}
    if source_input.get("kind") == "youtube": return clipper.download_video(str(source_input["url"]), directory)
    if source_input.get("kind") != "upload": raise ClipRenderError("clip source is not materializable video")
    data, _mime, filename = get_chat_attachment(str(source_input["attachmentId"]))
    suffix = Path(filename).suffix.lower()
    if suffix not in {".mp4", ".mov", ".webm", ".m4v"}:
        suffix = ".mp4"
    source = Path(directory) / f"source{suffix}"
    source.write_bytes(data)
    return source


def _source_failure(exc: Exception, *, category: str = "validation") -> dict[str, object]:
    return {
        "code": type(exc).__name__.lower(), "category": category,
        "publicMessage": str(exc)[:240], "retryable": isinstance(exc, (httpx.TimeoutException, httpx.TransportError)),
        "occurredAt": _now(),
    }


async def run_collect_sources(job_id: str) -> None:
    package = get_source_manifest(job_id)
    failed = False
    for source in package.get("sources") or []:
        source_id = str(source["id"])
        if source.get("state") in {"queued", "extracting", "ready", "excluded"}:
            continue
        if source.get("state") == "failed":
            failed = True
            continue
        try:
            web_patch(f"/api/internal/sources/{source_id}", {"outcome": "transition", "expectedState": "discovered", "nextState": "validating"})
            payload = get_source(source_id).get("payload") or {}
            source_input = payload.get("input") or {}
            if source_input.get("kind") in {"youtube", "web"}:
                assert_public_url(str(source_input.get("url") or ""))
            if not str(source_input.get("rightsAuthorizationId") or "").strip():
                raise ValueError("source rights authorization is required")
            web_patch(f"/api/internal/sources/{source_id}", {"outcome": "transition", "expectedState": "validating", "nextState": "queued"})
        except Exception as exc:
            failed = True
            web_patch(f"/api/internal/sources/{source_id}", {"outcome": "failed", "expectedState": "validating", "failure": _source_failure(exc)})
    web_post("/api/internal/source-manifest", {"jobId": job_id, "stage": "collect_sources", "outcome": "partial_failure" if failed else "all_ready"})


def _fetch_public_html(url: str) -> tuple[bytes, str, str]:
    current = assert_public_url(url)
    with httpx.Client(timeout=30, follow_redirects=False, headers={"User-Agent": "HarmoniaSourceExtractor/1.0"}) as client:
        for _ in range(6):
            response = client.get(current)
            if response.is_redirect:
                current = assert_public_url(str(response.url.join(response.headers["location"])))
                continue
            response.raise_for_status()
            body = response.content
            if len(body) > 5 * 1024 * 1024:
                raise ValueError("web response exceeds byte limit")
            return body, response.headers.get("content-type", ""), current
    raise ValueError("web source exceeded redirect limit")


def _extract_source(job: dict[str, Any], source: dict[str, Any], source_input: dict[str, Any]):
    source_id = str(source["id"]); receipt_id = f"extract:{source_id}:{uuid.uuid4().hex}"
    kind = source_input.get("kind")
    if kind == "pasted_text":
        return extract_text(source_id, str(source_input["title"]), str(source_input["text"]), "text/plain", receipt_id=receipt_id)
    if kind == "web":
        body, content_type, final_url = _fetch_public_html(str(source_input["url"]))
        return extract_html(source_id, final_url, body, content_type, receipt_id=receipt_id)
    if kind == "youtube":
        url = str(source_input["url"]); video_id = youtube.extract_video_id(url); meta = youtube.fetch_metadata(video_id)
        body, _digest = youtube.download_audio(url)
        return extract_media(source_id, str(meta.get("title") or "YouTube video"), body, "audio/mp4", invocation=InvocationContext(job_id=job["id"], workspace_id=job["workspaceId"], brand_id=job["brandId"], user_id=job["createdByUserId"], stage="extract_sources", operation_id=_invocation_operation_id(f"{job['id']}:extract_sources:{source_id}", source_id)), receipt_id=receipt_id).model_copy(update={"sourceKind": "video", "metadata": {"durationSec": youtube.probe_audio_duration(body), "youtubeUrl": url, "videoId": video_id}})
    if kind == "upload":
        body, mime, filename = get_chat_attachment(str(source_input["attachmentId"])); lowered = filename.lower()
        if mime == "application/pdf" or lowered.endswith(".pdf"): return extract_pdf(source_id, filename, body, receipt_id=receipt_id)
        if mime == "application/vnd.openxmlformats-officedocument.wordprocessingml.document" or lowered.endswith(".docx"): return extract_docx(source_id, filename, body, receipt_id=receipt_id)
        if mime.startswith("text/") or lowered.endswith((".txt", ".md")): return extract_text(source_id, filename, body.decode("utf-8"), "text/markdown" if lowered.endswith(".md") else "text/plain", receipt_id=receipt_id)
        if mime.startswith(("audio/", "video/")): return extract_media(source_id, filename, body, mime, invocation=InvocationContext(job_id=job["id"], workspace_id=job["workspaceId"], brand_id=job["brandId"], user_id=job["createdByUserId"], stage="extract_sources", operation_id=_invocation_operation_id(f"{job['id']}:extract_sources:{source_id}", source_id)), receipt_id=receipt_id)
        raise ValueError(f"unsupported uploaded source type: {mime}")
    raise ValueError(f"unsupported source kind: {kind}")


async def run_extract_sources(job_id: str) -> None:
    job = get_job(job_id); package = get_source_manifest(job_id); failed = False
    for source in package.get("sources") or []:
        if source.get("state") != "queued":
            if source.get("state") == "failed": failed = True
            continue
        source_id = str(source["id"])
        try:
            web_patch(f"/api/internal/sources/{source_id}", {"outcome": "transition", "expectedState": "queued", "nextState": "extracting"})
            source_input = (get_source(source_id).get("payload") or {}).get("input") or {}
            normalized = _extract_source(job, source, source_input)
            web_patch(f"/api/internal/sources/{source_id}", {"outcome": "ready", "expectedState": "extracting", "normalizedSource": normalized.model_dump(mode="json")})
        except Exception as exc:
            failed = True
            web_patch(f"/api/internal/sources/{source_id}", {"outcome": "failed", "expectedState": "extracting", "failure": _source_failure(exc, category="provider_transient" if isinstance(exc, (httpx.TimeoutException, httpx.TransportError)) else "validation")})
    web_post("/api/internal/source-manifest", {"jobId": job_id, "stage": "extract_sources", "outcome": "partial_failure" if failed else "all_ready"})


async def run_understand(job_id: str) -> None:
    job = get_job(job_id)
    source_package = get_source_manifest(job_id)
    normalized_sources = source_package.get("normalizedSources") or []
    if not normalized_sources:
        raise RuntimeError("job has no normalized sources")
    operation = current_operation()
    invocation = InvocationContext(
        job_id=job_id,
        workspace_id=job["workspaceId"],
        brand_id=job["brandId"],
        user_id=job["createdByUserId"],
        stage="understand", operation_id=_invocation_operation_id(f"{job_id}:understand:0"),
    )
    performance: list[AnalystPerformanceObservation] = []
    try:
        insights = get_insights()
        for item in (insights.get("topPosts") or [])[:5]:
            post_id = str(item.get("postId") or "").strip()
            if not post_id:
                continue
            performance.append(AnalystPerformanceObservation(
                id=f"performance:{post_id}",
                summary=(
                    f"Verified post {post_id}: {int(item.get('likes') or 0)} likes and "
                    f"{int(item.get('reposts') or 0)} reposts."
                ),
                firestoreEvidenceRef=f"engagement/{post_id}",
            ))
    except WebApiError:
        logger.info("no prior engagement insights yet")
    source_ids = [str(source["sourceId"]) for source in normalized_sources]
    kinds = {str(source["sourceKind"]) for source in normalized_sources}
    source_kind = next(iter(kinds)) if len(kinds) == 1 else "mixed"
    source_segments = []
    for source in normalized_sources:
        for segment_index, segment in enumerate(source.get("segments") or [], 1):
            source_segments.append({
                **segment,
                # Reassert stable evidence identity at the specialist handoff.
                # Older persisted transcripts may contain repeated model IDs.
                "id": f"{source['sourceId']}:seg-{segment_index}",
                "sourceId": source["sourceId"],
            })
    if not source_segments:
        raise RuntimeError("normalized source manifest has no evidence segments")
    source_digest = hashlib.sha256(_canonical_typed_bytes([
        {"sourceId": source["sourceId"], "contentDigest": source["contentDigest"]}
        for source in normalized_sources
    ]).encode("utf-8")).hexdigest()
    title = " + ".join(str(source.get("title") or source["sourceId"]) for source in normalized_sources)[:300]
    analyst_input = AnalystInput(
        sourceIds=source_ids,
        sourceKind=source_kind,
        sourceDigest=source_digest,
        title=title,
        operatorInstructions=[str(item.get("instruction"))[:300] for item in (job.get("steeringInstructions") or []) if item.get("instruction")],
        sourceSegments=source_segments[:500],
        performanceObservations=performance,
        memoryFacts=[],
        researchRequest=(job.get("config") or {}).get("analysisResearchRequest"),
    )
    run_result = await analyze_with_team(analyst_input, invocation=invocation)
    result = validate_source_analysis(
        analyst_input, run_result.analysis, research_evidence=run_result.searchEvidence,
    ).model_dump(mode="json", exclude_none=True)
    digest = hashlib.sha256(
        _canonical_typed_bytes(result).encode("utf-8")
    ).hexdigest()
    web_post("/api/internal/analysis", {
        "jobId": job_id, "stage": "understand",
        "analysis": result,
        "analysisDigest": digest,
        "modelUsed": content.model_used(),
        "researchRequest": (
            analyst_input.researchRequest.model_dump(mode="json")
            if analyst_input.researchRequest else None
        ),
        "searchEvidence": [
            {
                "evidenceId": evidence_id,
                "supportedText": values[0], "title": values[1], "url": values[2],
            }
            for evidence_id, values in run_result.searchEvidence.items()
        ],
        "searchProvenance": run_result.searchProvenance,
    })


def _strategy_input(job: dict[str, Any], insights: dict[str, Any]) -> StrategistInput:
    context = (job.get("config") or {}).get("strategyContext")
    if not isinstance(context, dict):
        raise AgentProtocolError("job requires typed strategyContext")
    analysis = SourceAnalysis.model_validate(job.get("sourceAnalysis"))
    performance = []
    for item in (insights.get("topPosts") or [])[:5]:
        post_id = str(item.get("postId") or "").strip()
        if post_id:
            performance.append(PerformanceObservation(
                id=f"performance:{post_id}",
                summary=f"Verified post {post_id}: {int(item.get('likes') or 0)} likes and {int(item.get('reposts') or 0)} reposts.",
                firestoreEvidenceRef=f"engagement/{post_id}",
            ))
    revision = int(job.get("strategyRevision") or 1)
    return StrategistInput(
        source_title=str((job.get("sourceAnalysis") or {}).get("summary") or f"Source bundle {(job.get('config') or {}).get('sourceManifestId', '')[:12]}")[:300],
        company=CompanyContext(
            evidenceId="context:company",
            **{key: context[key] for key in ("company", "product", "positioning", "differentiators", "brandVoice", "exclusions", "safetyConstraints")},
        ),
        campaign=CampaignContext(
            evidenceId="context:campaign",
            operatorBrief=(job.get("config") or {}).get("operatorBrief"),
            **{key: context[key] for key in ("businessObjectives", "campaignObjectives", "audiences", "funnelStage", "intendedConversion", "requestedChannels", "supportedChannels")},
            horizonWeeks=int(context.get("horizonWeeks") or 4),
        ),
        analysis=analysis, performance=performance, revision=revision,
        researchRequest=context.get("researchRequest"),
        revisionFeedback="\n".join(filter(None, [job.get("strategyRevisionFeedback"), *[str(item.get("instruction")) for item in (job.get("steeringInstructions") or []) if item.get("instruction")]])) or None,
    )


async def run_strategize(job_id: str) -> None:
    job = get_job(job_id)
    try:
        insights = get_insights()
    except WebApiError:
        insights = {}
    revision = int(job.get("strategyRevision") or 1)
    operation = current_operation()
    invocation = InvocationContext(
        job_id=job_id, workspace_id=job["workspaceId"], brand_id=job["brandId"],
        user_id=job["createdByUserId"], stage="strategize",
        operation_id=_invocation_operation_id(f"{job_id}:strategize:{revision - 1}"),
    )
    prepared = await prepare_strategist_input(_strategy_input(job, insights), invocation=invocation)
    web_post("/api/internal/strategy-context", {
        "jobId": job_id, "stage": "strategize", "revision": revision,
        "sourceIds": sorted({
            *[item.id for item in prepared.analysis.moments],
            *[ref for item in prepared.analysis.moments for ref in item.sourceSegmentRefs],
            *[item.id for item in prepared.analysis.angles],
            *[ref for item in prepared.analysis.angles for ref in item.evidenceRefs],
        }),
        "operatorContextIds": [prepared.company.evidenceId, prepared.campaign.evidenceId],
        "performance": [{"id": item.id, "firestoreEvidenceRef": item.firestoreEvidenceRef} for item in prepared.performance],
        "memoryFacts": [{"id": item.id, "firestoreEvidenceRef": item.firestoreEvidenceRef} for item in prepared.memoryFacts],
        "audienceIds": [item.id for item in prepared.campaign.audiences],
        "requestedChannels": prepared.campaign.requestedChannels,
        "supportedChannels": prepared.campaign.supportedChannels,
        "horizonWeeks": prepared.campaign.horizonWeeks,
        "researchRequest": (
            prepared.researchRequest.model_dump(mode="json")
            if prepared.researchRequest else None
        ),
        "searchEvidence": [],
    })
    result = await strategize_with_team(prepared, invocation=invocation, prepared=True)
    web_post("/api/internal/strategy", {
        "jobId": job_id, "stage": "strategize", "revision": revision,
        "strategy": result.strategy.model_dump(mode="json"), "modelUsed": content.model_used(),
        "searchEvidence": [
            {"evidenceId": evidence_id, "supportedText": values[0], "title": values[1], "url": values[2]}
            for evidence_id, values in result.searchEvidence.items()
        ],
        "searchProvenance": result.searchProvenance,
    })


async def run_plan(job_id: str) -> None:
    fence = current_operation()
    job = get_job(job_id)
    strategy = job.get("contentStrategy")
    digest = job.get("strategyDigest")
    approval = job.get("strategyApproval") or {}
    revision = int(job.get("editorialPlanRevision") or 1)
    if not isinstance(strategy, dict) or not digest:
        raise AgentProtocolError("persisted approved strategy required before Temi")
    if (
        job.get("strategyApprovalState") != "approved"
        or approval.get("decision") != "approved"
        or approval.get("payloadDigest") != digest
        or approval.get("revision") != job.get("strategyRevision")
    ):
        raise AgentProtocolError("digest-bound approved strategy required before Temi")
    snapshot_result = get_editorial_planning_snapshot(job_id)
    snapshot = snapshot_result.get("snapshot")
    snapshot_digest = snapshot_result.get("digest")
    if not isinstance(snapshot, dict) or not isinstance(snapshot_digest, str):
        raise AgentProtocolError("persisted editorial planning snapshot required before Temi")
    planner_input = EditorialPlannerInput.model_validate({
        "strategy": strategy,
        "strategyDigest": digest,
        "strategyVersion": strategy["version"],
        "strategyApproval": approval,
        "analysis": job.get("sourceAnalysis"),
        "planningSnapshot": snapshot,
        "planningSnapshotDigest": snapshot_digest,
        "revision": revision,
    })
    result = await plan_with_team(planner_input, invocation=InvocationContext(
        job_id=job_id, workspace_id=job["workspaceId"], brand_id=job["brandId"],
        user_id=job["createdByUserId"], stage="plan",
        operation_id=_invocation_operation_id(f"{job_id}:plan:{revision - 1}"),
    ))
    web_post("/api/internal/editorial-plan", {
        "jobId": job_id, "stage": "plan", "revision": revision,
        "plan": result.model_dump(mode="json"), "modelUsed": content.model_used(),
    })


async def run_draft(job_id: str) -> None:
    fence = current_operation()
    job = get_job(job_id)
    approval = job.get("strategyApproval") or {}
    if approval.get("decision") != "approved" or approval.get("payloadDigest") != job.get("strategyDigest"):
        raise AgentProtocolError("digest-bound approved strategy required before Temi")
    expires_at = approval.get("expiresAt")
    decided_at = approval.get("decidedAt")
    if not expires_at or not decided_at or datetime.fromisoformat(decided_at.replace("Z", "+00:00")) > datetime.fromisoformat(expires_at.replace("Z", "+00:00")):
        raise AgentProtocolError("strategy approval was decided after expiry")
    raw_plan = job.get("editorialPlan")
    stored_digest = job.get("editorialPlanDigest")
    selected_id = job.get("selectedNextItemId")
    if not isinstance(raw_plan, dict) or not stored_digest or not selected_id:
        raise AgentProtocolError("persisted editorial plan authority required before Noni")
    if editorial_plan_digest(raw_plan) != stored_digest:
        raise AgentProtocolError("persisted editorial plan digest mismatch")
    try:
        editorial_plan = EditorialPlan.model_validate(raw_plan)
    except ValidationError as exc:
        raise AgentProtocolError(f"invalid persisted editorial plan: {exc}") from exc
    if editorial_plan.selectedNextItemId != selected_id:
        raise AgentProtocolError("persisted selected editorial item mismatch")
    if editorial_plan.approvedStrategyDigest != job.get("strategyDigest"):
        raise AgentProtocolError("editorial plan approved strategy digest mismatch")
    item_state = (job.get("editorialItemStates") or {}).get(selected_id) or {}
    if item_state.get("status") not in {"selected", "drafting"}:
        raise AgentProtocolError("selected editorial item is not eligible for drafting")
    selected = next((item for item in editorial_plan.items if item.id == selected_id), None)
    approval_revision = approval.get("revision")
    strategy_record = (job.get("strategyHistory") or {}).get(f"v{approval_revision}") or {}
    strategy = strategy_record.get("strategy") or {}
    if (
        strategy_record.get("digest") != job.get("strategyDigest")
        or strategy_record.get("revision") != approval_revision
        or strategy.get("version") != approval_revision
    ):
        raise AgentProtocolError("immutable approved strategy history required before Noni")
    brief = next((item for item in strategy.get("briefs", []) if item.get("id") == selected.briefId), None) if selected else None
    if selected is None or brief is None:
        raise AgentProtocolError("selected editorial item has no exact approved brief")
    evidence_ids = set(selected.evidenceRefs)
    source_analysis = SourceAnalysis.model_validate(job.get("sourceAnalysis"))
    analysis_json = source_analysis.model_dump(mode="json", exclude_none=True)
    moments = [item for item in analysis_json["moments"] if item["id"] in evidence_ids]
    angles = [item for item in analysis_json["angles"] if item["id"] in evidence_ids]
    source_ids = {item["id"] for item in [*moments, *angles]}
    expected_source_ids = evidence_ids & {
        *(item["id"] for item in analysis_json["moments"]),
        *(item["id"] for item in analysis_json["angles"]),
    }
    if source_ids != expected_source_ids or not source_ids:
        raise AgentProtocolError("selected brief source evidence is missing")
    artifact_output_types = {"x_post", "x_thread", "linkedin_post", "blog_article", "newsletter", "caption", "carousel_spec", "quote_card", "diagram", "editorial_calendar", "content_pack"}
    output_plan = job.get("campaignOutputPlan")
    if not isinstance(output_plan, dict):
        recovered = web_post("/api/internal/output-plan/reconcile", {"jobId": job_id})
        output_plan = recovered.get("plan")
    if not isinstance(output_plan, dict):
        raise AgentProtocolError("campaign output plan recovery did not return a plan")
    requested = [item for item in (output_plan.get("outputs") or []) if item.get("outputType") in artifact_output_types]
    if requested:
        source_package = get_source_manifest(job_id); evidence_by_id: dict[str, str] = {}
        for source in source_package.get("normalizedSources") or []:
            for index, segment in enumerate(source.get("segments") or [], start=1):
                # Nimi receives position-derived segment identities because provider
                # IDs are not trustworthy or unique. Recreate that exact identity
                # here instead of reusing persisted provider IDs.
                evidence_id = f"{source['sourceId']}:seg-{index}"
                evidence_by_id[evidence_id] = str(segment.get("text") or "")
        required_refs = list(dict.fromkeys(ref for item in requested for ref in (item.get("evidenceRefs") or [])))
        missing = [ref for ref in required_refs if ref not in evidence_by_id]
        if missing: raise AgentProtocolError(f"artifact output plan references unknown normalized evidence: {missing}")
        production_input = ArtifactProductionInput.model_validate({
            "operatorBrief": (job.get("config") or {}).get("operatorBrief"),
            "outputPlanId": output_plan["id"], "outputPlanDigest": output_plan["digest"],
            "requests": [{"id": item["id"], "outputType": item["outputType"], "evidenceRefs": item["evidenceRefs"]} for item in requested],
            "evidence": [{"id": ref, "text": evidence_by_id[ref]} for ref in required_refs],
            "brandContext": json.dumps({"strategicThesis": strategy.get("thesis"), "differentiatedNarrative": strategy.get("differentiatedNarrative"), "brandSafety": strategy.get("brandSafety") or []}, sort_keys=True)[:4000],
            "constraints": [*selected.constraints, *strategy.get("brandSafety", []), *[str(item.get("instruction"))[:300] for item in (job.get("steeringInstructions") or []) if item.get("instruction")]],
            "passType": "original", "priorBatch": None, "priorReview": None,
        })
        claim = web_post("/api/internal/content-artifacts/claim", {
            "jobId": job_id,
            "editorialPlanId": editorial_plan.planId, "editorialPlanDigest": stored_digest,
            "editorialItemId": selected.id, "briefId": selected.briefId,
        })
        if claim.get("outcome") != "execute":
            raise AgentProtocolError("selected editorial item drafting claim was not granted")
        result = await produce_artifacts_with_team(production_input, invocation=InvocationContext(job_id=job_id, workspace_id=job["workspaceId"], brand_id=job["brandId"], user_id=job["createdByUserId"], stage="draft", operation_id=_invocation_operation_id(f"{job_id}:draft:artifacts:0", "artifacts")))
        submission_result = result.model_dump(mode="json", by_alias=True, exclude_none=True)
        # The TypeScript boundary requires these lifecycle slots explicitly,
        # while optional fields inside artifact payloads must be omitted rather
        # than serialized as JSON null.
        submission_result.setdefault("revision", None)
        submission_result.setdefault("finalReview", None)
        from .role_models import load_role_model_catalog
        web_post("/api/internal/content-artifacts", {"jobId": job_id, "stage": "draft", "operation": "complete", "producerModel": load_role_model_catalog().copywriter.model_id, "editorialPlanId": editorial_plan.planId, "editorialPlanDigest": stored_digest, "editorialItemId": selected.id, "briefId": selected.briefId, "result": submission_result})
        return
    raise AgentProtocolError("campaign output plan contains no supported typed content artifacts")


def _idempotency_key(job_id: str, action: dict) -> str:
    material = json.dumps({"j": job_id, "a": action["id"], "p": action["payload"]}, sort_keys=True)
    return hashlib.sha256(material.encode()).hexdigest()


def _receipts_for_job(job_id: str) -> list[dict[str, Any]]:
    from .web_client import _client

    with _client() as c:
        res = c.get(f"/api/internal/job/{job_id}/receipts")
    if res.status_code != 200:
        return []
    return res.json().get("receipts", [])


def _ordered_effect_commands(commands: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Topologically order prepared host commands and stop on unresolved authority dependencies."""
    by_id = {str(command.get("id")): command for command in commands}
    ordered: list[dict[str, Any]] = []
    visiting: set[str] = set()
    visited: set[str] = set()

    def visit(command: dict[str, Any]) -> None:
        command_id = str(command.get("id") or "")
        if command_id in visited:
            return
        if command_id in visiting:
            raise ValueError("effect command dependency cycle")
        if command.get("state") != "prepared":
            return
        visiting.add(command_id)
        for dependency_id in command.get("dependsOnCommandIds") or []:
            dependency = by_id.get(str(dependency_id))
            if dependency is None:
                raise ValueError(f"effect command dependency {dependency_id} is missing")
            dependency_state = str(dependency.get("state") or "")
            if dependency_state == "prepared":
                visit(dependency)
            elif dependency_state != "applied":
                raise EffectClaimUncertain(
                    f"effect command dependency {dependency_id} is {dependency_state or 'invalid'}"
                )
        visiting.remove(command_id)
        visited.add(command_id)
        ordered.append(command)

    for candidate in commands:
        visit(candidate)
    return ordered


async def run_publish(job_id: str) -> None:
    job = get_job(job_id)
    commands = _ordered_effect_commands(get_effect_commands(job_id))
    done_keys = {
        r["idempotencyKey"] for r in _receipts_for_job(job_id)
        if r["outcome"] in ("applied", "already_applied")
    }

    for command in commands:
        control = get_job(job_id).get("controlState", "running")
        if control != "running":
            raise RuntimeError(f"job control state blocks effects: {control}")
        action = {
            "id": command["actionId"],
            "type": command["actionType"],
            "payload": command["payload"],
        }
        if action["type"] in {"generate_video", "generate_music"}:
            raise AgentProtocolError(
                "paid media operations must execute through the sealed production executor"
            )
        key = command["payloadDigest"]
        if action["type"] in {
            "export_content_artifact", "publish_x_post", "publish_x_thread",
            "publish_linkedin_post",
        }:
            connection_kind = (
                "x" if action["type"] in {"publish_x_post", "publish_x_thread"}
                else "linkedin" if action["type"] == "publish_linkedin_post"
                else None
            )
            connection = get_connection(connection_kind) if connection_kind else {}
            adapters = production_adapters(
                x_access_token=str(connection.get("accessToken") or "") if connection_kind == "x" else "",
                linkedin_access_token=str(connection.get("accessToken") or "") if connection_kind == "linkedin" else "",
                job_id=job_id,
            )
            result = execute_effect_command(
                command,
                adapters=adapters,
            )
            if result.outcome == "in_progress":
                raise EffectClaimInProgress("another worker currently owns this effect")
            if result.outcome in {"uncertain", "unknown"}:
                raise EffectClaimUncertain("a prior effect attempt has no final receipt")
            if result.outcome in {"paused", "cancelled"}:
                return
            continue
        trace_id = current_trace_id()
        operation_id = f"job:{job_id}:effect:{command['id']}"
        claim_token = uuid.uuid4().hex
        claim_result = claim_effect({
            "commandId": command["id"],
            "jobId": job_id, "actionId": action["id"], "actionType": action["type"],
            "idempotencyKey": key, "operationId": operation_id,
            "traceId": trace_id, "claimToken": claim_token,
        })
        if claim_result["outcome"] == "already_applied":
            continue
        if claim_result["outcome"] == "in_progress":
            raise EffectClaimInProgress("another worker currently owns this effect")
        if claim_result["outcome"] == "uncertain":
            raise EffectClaimUncertain("a prior effect attempt has no final receipt")
        if claim_result["outcome"] in {"paused", "cancelled"}:
            return
        operation_epoch = int(claim_result.get("operationEpoch") or 0)
        if operation_epoch < 1:
            raise RuntimeError("effect claim is missing its operation epoch")
        effect_identity = {
            "commandId": command["id"], "jobId": job_id,
            "actionId": action["id"], "actionType": action["type"],
            "idempotencyKey": key, "operationId": operation_id,
            "operationEpoch": operation_epoch,
            "traceId": trace_id, "claimToken": claim_token,
        }
        effect_receipt_identity = {
            key_name: value for key_name, value in effect_identity.items()
            if key_name != "operationEpoch"
        }
        with operation_scope(
            operation_id, operation_epoch,
            goal_digest=claim_result.get("goalDigest"),
        ):
            transition_effect_command("dispatched", {
                **effect_identity, "attempt": int(claim_result.get("attempt") or 1),
            })
        detail: dict[str, Any] = {"idempotencyKey": key}
        outcome, artifact = "failed", None
        try:
            if action["type"] == "generate_image":
                if key in done_keys:
                    outcome, detail["note"] = "already_applied", "receipt exists; skipped"
                else:
                    img_bytes, mime = content.generate_image(
                        action["payload"]["prompt"],
                        invocation=InvocationContext(
                            job_id=job_id,
                            workspace_id=job["workspaceId"],
                            brand_id=job["brandId"],
                            user_id=job["createdByUserId"],
                            stage="publish",
                            operation_id=f"{job_id}:publish:{action['id']}",
                        ),
                    )
                    digest = hashlib.sha256(img_bytes).hexdigest()
                    import base64

                    web_post("/api/internal/asset", {
                        "jobId": job_id, "actionId": action["id"], "mime": mime,
                        "dataBase64": base64.b64encode(img_bytes).decode(),
                        "digest": digest,
                    })
                    outcome = "applied"
                    artifact = {
                        "kind": "asset_store",
                        "url": f"/api/jobs/{job_id}/assets/{action['id']}",
                        "fetchedAt": _now(), "digest": digest,
                    }
                    detail.update({"digest": digest, "mime": mime, "bytes": len(img_bytes)})
            elif action["type"] in ("render_clip", "render_reel"):
                if key in done_keys:
                    outcome, detail["note"] = "already_applied", "receipt exists; skipped"
                else:
                    outcome = "applied"
                    import tempfile
                    from pathlib import Path

                    fmt = action["payload"].get("format", "vertical")
                    want_caps = action["payload"].get("captions", True)
                    render_notes: list[str] = []
                    with tempfile.TemporaryDirectory() as td:
                        if action["type"] == "render_clip":
                            moment = next(
                                (m for m in _source_moments(job) if m["id"] == action["payload"]["momentId"]),
                                None,
                            )
                            if not moment:
                                raise ClipRenderError("moment referenced by render_clip no longer exists")
                            src = _materialize_source_video(job_id, moment, td)
                            out = Path(td) / "clip.mp4"
                            render_notes += clipper.render_clip(
                                src, out,
                                float(moment["startSec"]), float(moment["endSec"]),
                                fmt=fmt,
                                captions=_segments_in_window(job_id, float(moment["startSec"]), float(moment["endSec"])) if want_caps else None,
                            )
                        else:
                            parts: list[Path] = []
                            for i, mid in enumerate(action["payload"]["momentIds"]):
                                m = next((m for m in _source_moments(job) if m["id"] == mid), None)
                                if not m:
                                    raise ClipRenderError(f"moment {mid} no longer exists")
                                src = _materialize_source_video(job_id, m, td)
                                part = Path(td) / f"part{i}.mp4"
                                render_notes += clipper.render_clip(
                                    src, part,
                                    float(m["startSec"]), float(m["endSec"]),
                                    fmt=fmt,
                                    captions=_segments_in_window(job_id, float(m["startSec"]), float(m["endSec"])) if want_caps else None,
                                )
                                parts.append(part)
                            out = Path(td) / "reel.mp4"
                            clipper.render_reel(parts, out)
                        video_bytes = out.read_bytes()

                    digest = hashlib.sha256(video_bytes).hexdigest()
                    web_post_raw_asset(
                        job_id, action["id"], "video/mp4", digest, video_bytes,
                    )
                    artifact = {
                        "kind": "asset_store",
                        "url": f"/api/jobs/{job_id}/assets/{action['id']}",
                        "fetchedAt": _now(), "digest": digest,
                    }
                    detail.update({
                        "digest": digest, "mime": "video/mp4",
                        "bytes": len(video_bytes), "format": fmt,
                        **({"notes": render_notes} if render_notes else {}),
                    })
        except (x_client.XError, content.ImageGenError, ClipRenderError) as exc:
            outcome, detail["error"] = "failed", str(exc)
        except Exception as exc:
            with operation_scope(operation_id, operation_epoch):
                transition_effect_command("unknown", {
                    **effect_identity,
                    "reason": f"{type(exc).__name__}: {exc}",
                })
            raise

        with operation_scope(operation_id, operation_epoch):
            transition_effect_command("observed", {
                **effect_identity, "outcome": outcome,
                "artifact": artifact, "detail": detail,
            })
            web_post("/api/internal/receipt", {
                **effect_receipt_identity, "outcome": outcome,
                "artifact": artifact, "detail": detail,
            })

    refreshed = get_job(job_id)
    if refreshed["stage"] == "publish":
        web_post(f"/api/internal/publish/{job_id}/complete", {"stage": "publish"})


async def run_verify(job_id: str) -> None:
    job = get_job(job_id)
    receipts = _receipts_for_job(job_id)
    receipt_by_action = {r["actionId"]: r for r in receipts}
    results: list[dict[str, Any]] = []
    trace_id = current_trace_id()

    for action in job.get("actions", []):
        if action.get("state") != "executed":
            continue
        receipt = receipt_by_action.get(action["id"])
        if not receipt:
            raise RuntimeError(f"executed action {action['id']} has no durable receipt")
        detail = receipt.get("detail", {})
        lineage = {
            "receiptId": receipt["id"],
            "operationId": f"{job_id}:verify:{action['id']}",
            "traceId": trace_id,
        }
        if action["type"] == "export_content_artifact":
            payload = action.get("payload") or {}
            artifact_id = str(payload.get("artifactId") or "")
            artifact_digest = str(payload.get("artifactDigest") or "")
            try:
                artifact_record = ContentArtifactRecord.model_validate(
                    get_content_artifact(job_id, artifact_id, artifact_digest)
                )

                def read_exported(object_id: str, expected_bytes: int) -> bytes | None:
                    page = read_artifact(object_id, offset=0, length=expected_bytes)
                    import base64

                    if not page.get("complete"):
                        raise ArtifactVerificationError("exported object exceeds its receipted byte length")
                    return base64.b64decode(str(page["dataBase64"]), validate=True)

                verified_identity = verify_content_artifact_export(
                    artifact_record, detail, read=read_exported,
                )
                verified = True
                note = "stored Markdown and canonical JSON bytes match the immutable content artifact"
                # Verification evidence binds to the independently reread provider object,
                # while verify_content_artifact_export separately proves that object's
                # semantic artifact identity and deterministic Markdown projection.
                observed_digest = str(detail.get("jsonSha256") or "")
                if not re.fullmatch(r"[a-f0-9]{64}", observed_digest):
                    raise ArtifactVerificationError("export receipt JSON digest is missing")
            except (ArtifactVerificationError, ValidationError, WebApiError, ValueError) as exc:
                verified = False
                note = f"content artifact export verification failed: {exc}"
                observed_digest = None
            results.append({
                "target": f"content-artifact:{artifact_id}", "actionId": action["id"],
                "verified": verified, "method": "artifact_digest_reread", **lineage,
                "evidence": {
                    "kind": "asset_store", "url": f"/api/internal/artifacts/{detail.get('jsonObjectId', '')}",
                    "fetchedAt": _now(), "digest": observed_digest,
                },
                "note": note,
            })
        elif action["type"] == "publish_x_post" and detail.get("id"):
            connection = get_connection("x")
            post = x_client.get_post(str(detail["id"]), connection.get("accessToken"))
            observed_digest = hashlib.sha256(str(post.get("text", "")).encode()).hexdigest() if post else None
            expected_digest = (receipt.get("artifact") or {}).get("digest")
            content_matches = bool(post and expected_digest and observed_digest == expected_digest)
            results.append({
                "target": f"x:{detail['id']}", "actionId": action["id"],
                "verified": content_matches,
                "method": "official_api_readback", **lineage,
                "evidence": {"kind": "x_api", "url": detail.get("url", ""), "fetchedAt": _now(), "digest": observed_digest},
                "note": (
                    "X readback content digest matches the receipted approved content"
                    if content_matches else
                    "tweet not found on refetch"
                    if not post else
                    "X readback content digest does not match the receipted approved content"
                ),
            })
        elif action["type"] == "publish_x_thread" and detail.get("postIds"):
            connection = get_connection("x")
            posts = action.get("payload", {}).get("posts") or []
            provider_ids = detail.get("postIds") or []
            observed = [
                x_client.get_post(str(post_id), connection.get("accessToken"))
                for post_id in provider_ids
            ]
            expected_texts = [str(post.get("text") or "") for post in posts]
            observed_texts = [str(post.get("text") or "") if post else "" for post in observed]
            observed_digest = hashlib.sha256("\n".join(observed_texts).encode()).hexdigest()
            expected_digest = (receipt.get("artifact") or {}).get("digest")
            matches = len(provider_ids) == len(posts) and observed_texts == expected_texts and observed_digest == expected_digest
            results.append({
                "target": f"x-thread:{provider_ids[0]}", "actionId": action["id"],
                "verified": matches, "method": "official_api_readback", **lineage,
                "evidence": {"kind": "x_api", "url": detail.get("url", ""), "fetchedAt": _now(), "digest": observed_digest},
                "note": "every X thread post was independently read and matched in order" if matches else "X thread readback mismatch",
            })
        elif action["type"] == "publish_linkedin_post" and detail.get("id"):
            connection = get_connection("linkedin")
            payload = action.get("payload") or {}
            post = LinkedInClient(str(connection.get("accessToken") or "")).get_post(str(detail["id"]), payload.get("destination") or {})
            observed_digest = hashlib.sha256(post["text"].encode()).hexdigest()
            expected_digest = (receipt.get("artifact") or {}).get("digest")
            matches = bool(expected_digest and observed_digest == expected_digest)
            results.append({
                "target": f"linkedin:{detail['id']}", "actionId": action["id"],
                "verified": matches, "method": "official_api_readback", **lineage,
                "evidence": {"kind": "linkedin_api", "url": post["url"], "fetchedAt": _now(), "digest": observed_digest},
                "note": "LinkedIn readback content and destination match the approved artifact" if matches else "LinkedIn readback content digest mismatch",
            })
        elif action["type"] in (
            "generate_image", "generate_video", "generate_music",
            "render_clip", "render_reel",
        ) and detail.get("digest"):
            stored = get_asset(job_id, action["id"])
            actual = (stored or {}).get("digest", "")
            results.append({
                "target": f"asset:{action['id']}", "actionId": action["id"],
                "verified": bool(stored) and actual == detail["digest"],
                "method": "artifact_digest_reread", **lineage,
                "evidence": {
                    "kind": "asset_store",
                    "url": f"/api/jobs/{job_id}/assets/{action['id']}",
                    "fetchedAt": _now(), "digest": actual,
                },
                "note": "stored asset digest matches receipt" if stored else "asset missing from store",
            })

    web_post("/api/internal/verification", {"jobId": job_id, "results": results})


async def run_learn(job_id: str) -> None:
    """Closes the loop: measure published posts, derive takeaways, complete job."""
    job = get_job(job_id)
    receipts = _receipts_for_job(job_id)
    receipt_by_action = {r["actionId"]: r for r in receipts}

    engagement: list[dict[str, Any]] = []
    for action in job.get("actions", []):
        if action.get("type") != "publish_x_post" or action.get("state") != "executed":
            continue
        post_id = receipt_by_action.get(action["id"], {}).get("detail", {}).get("id")
        if not post_id:
            continue
        connection = get_connection("x")
        metrics = x_client.get_post_metrics(str(post_id), connection.get("accessToken"))
        if not metrics:
            continue
        engagement.append({
            "actionId": action["id"],
            "postId": str(post_id),
            **metrics,
        })

    notes: list[str] = []
    if engagement:
        best = max(engagement, key=lambda e: (e["likes"], e["reposts"]))
        draft_text = next(
            (
                a["payload"].get("text", "")
                for a in job.get("actions", [])
                if a["id"] == best["actionId"]
            ),
            "",
        )
        notes.append(f"top post earned {best['likes']} likes / {best['reposts']} reposts")
        if draft_text:
            notes.append(f"winning pattern to double down on: \"{draft_text[:160]}\"")
    else:
        notes.append("no published posts measured yet (X publishing optional)")

    summary = (
        f"{len(engagement)} published post(s) measured; "
        + (notes[0] if engagement else "insights will accrue as posts publish.")
    )
    memory = configured_memory(InvocationContext(
        job_id=job_id,
        workspace_id=job["workspaceId"],
        brand_id=job["brandId"],
        user_id=job["createdByUserId"],
        stage="learn",
        operation_id=_invocation_operation_id(f"{job_id}:learn:0"),
    ))
    if memory is not None:
        bank, scope = memory
        candidates = eligible_job_memories(job, measured_posts=len(engagement))
        await asyncio.to_thread(bank.generate, scope=scope, candidates=candidates)
    web_post("/api/internal/engagement", {
        "jobId": job_id,
        "stage": "learn",
        "engagement": engagement,
        "learnings": {"summary": summary, "notes": notes},
    })


HANDLERS: dict[str, Handler] = {
    "collect_sources": run_collect_sources,
    "extract_sources": run_extract_sources,
    "understand": run_understand,
    "strategize": run_strategize,
    "plan": run_plan,
    "draft": run_draft,
    "publish": run_publish,
    "verify": run_verify,
    "learn": run_learn,
}


def classify_failure(exc: Exception) -> bool:
    """Compatibility view: True means acknowledge instead of retrying."""
    envelope = normalize_failure(
        exc,
        stage="unknown",
        operation_id="compatibility:unknown:0",
        trace_id="0" * 32,
        attempt=0,
    )
    return not envelope.retryable


def _failure_payload(job_id: str, envelope: FailureEnvelope) -> dict[str, object]:
    return {
        "jobId": job_id,
        "stage": envelope.stage,
        "category": envelope.category.value,
        "code": envelope.code,
        "publicMessage": envelope.public_message,
        "retryable": envelope.retryable,
        "operationId": envelope.operation_id,
        "traceId": envelope.trace_id,
        "attempt": envelope.attempt,
        "maxAttempts": envelope.max_attempts,
        "details": envelope.details,
    }


async def dispatch(job_id: str, stage: str, *, attempt: int = 0, operation_id: str | None = None) -> bool:
    with tracer().start_as_current_span("harmonia.stage.execute") as span:
        span.set_attributes(safe_attributes({
            "job.id": job_id,
            "stage": stage,
            "attempt": attempt,
        }))
        job_control = get_job(job_id).get("controlState", "running")
        if job_control in {"paused", "cancelled"}:
            span.set_attributes(safe_attributes({"job.control_state": job_control}))
            return True
        execution_operation_id = operation_id or f"job:{job_id}:stage:{stage}:generation:0"
        handler = HANDLERS.get(stage)
        if handler is None:
            envelope = normalize_failure(
                RuntimeError("stage handler is missing"),
                stage=stage,
                operation_id=execution_operation_id,
                trace_id=current_trace_id(),
                attempt=attempt,
                category=FailureCategory.PROTOCOL,
                code="missing_stage_handler",
            )
            span.set_status(Status(StatusCode.ERROR, envelope.code))
            web_post("/api/internal/failure", _failure_payload(job_id, envelope))
            return "failed"
        claim_token = secrets.token_urlsafe(32)
        claim = claim_stage_execution({
            "jobId": job_id,
            "stage": stage,
            "operationId": execution_operation_id,
            "ownerId": f"worker:{os.getpid()}",
            "claimToken": claim_token,
        })
        claim_outcome = claim["outcome"]
        if claim_outcome in {"failed", "uncertain"}:
            envelope = normalize_failure(
                RuntimeError(f"persisted stage execution is {claim_outcome}"),
                stage=stage,
                operation_id=execution_operation_id,
                trace_id=current_trace_id(),
                attempt=attempt,
                category=FailureCategory.DEPENDENCY,
                code=f"stage_execution_{claim_outcome}",
                details={"claimOutcome": claim_outcome},
            )
            span.set_attributes(safe_attributes({"stage.claim_outcome": claim_outcome}))
            web_post("/api/internal/failure", _failure_payload(job_id, envelope))
            return "failed"
        if claim_outcome != "execute":
            span.set_attributes(safe_attributes({"stage.claim_outcome": claim_outcome}))
            return True
        try:
            operation_token = _ACTIVE_STAGE_OPERATION_ID.set(execution_operation_id)
            try:
                await handler(job_id)
            finally:
                _ACTIVE_STAGE_OPERATION_ID.reset(operation_token)
            finalize_stage_execution({
                "jobId": job_id,
                "stage": stage,
                "operationId": execution_operation_id,
                "claimToken": claim_token,
                "outcome": "applied",
            })
            return True
        except Exception as exc:  # noqa: BLE001 - classified then reported
            envelope = normalize_failure(
                exc,
                stage=stage,
                operation_id=execution_operation_id,
                trace_id=current_trace_id(),
                attempt=attempt,
            )
            span.set_attributes(safe_attributes({
                "failure.category": envelope.category.value,
                "failure.code": envelope.code,
                "failure.retryable": envelope.retryable,
            }))
            span.set_status(Status(StatusCode.ERROR, envelope.code))
            logger.error(
                "stage %s failed for %s (%s/%s retryable=%s)",
                stage, job_id, envelope.category.value, envelope.code, envelope.retryable,
            )
            try:
                web_post("/api/internal/failure", _failure_payload(job_id, envelope))
            except Exception:  # noqa: BLE001
                logger.exception("failure reporting also failed")
            try:
                finalize_stage_execution({
                    "jobId": job_id,
                    "stage": stage,
                    "operationId": execution_operation_id,
                    "claimToken": claim_token,
                    "outcome": "failed" if not envelope.retryable else "uncertain",
                    "failureReason": envelope.code,
                })
            except Exception:  # noqa: BLE001
                logger.exception("stage claim finalization also failed")
            return "failed"
