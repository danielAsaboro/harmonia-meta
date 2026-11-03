"""Nimi-to-Ryan stage wiring and approved Temi handoff."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

import pytest

from harmonia_agent import stages
from harmonia_agent.agent_models import SourceAnalysis
from harmonia_agent.agents import AnalysisRunResult, StrategyRunResult
from harmonia_agent.operation_context import operation_scope
from tests.test_ryan_strategy import strategy
from tests.web_search_fixtures import search_provenance


def job() -> dict:
    return {
        "id": "job-1", "workspaceId": "workspace-test", "brandId": "brand-test",
        "createdByUserId": "user-test",
        "sourceAnalysis": {
            "sourceDigest": "a" * 64, "summary": "Activation time fell.",
            "moments": [{"id": "m1", "title": "Activation", "startSec": 2, "endSec": 8, "hook": "Nine days to forty hours", "quote": "we cut nine days to forty hours", "sourceSegmentRefs": ["segment-1"], "visualEvidenceIds": [], "assumptions": [], "confidence": "high"}],
            "angles": [{"id": "a1", "angleType": "source_insight", "evidenceKind": "source", "title": "Operational speed", "rationale": "The source demonstrates a measurable operational improvement.", "evidenceRefs": ["m1"], "assumptions": [], "confidence": "high"}],
            "assumptions": [], "confidence": "high",
        },
        "analysisDigest": "b" * 64,
        "config": {"brief": "Explain the activation result", "strategyContext": {
            "company": "Harmonia", "product": "A governed content engine",
            "positioning": "Evidence-grounded content operations", "differentiators": ["approval-bound effects"],
            "brandVoice": ["direct"], "exclusions": ["fabricated outcomes"],
            "safetyConstraints": ["never imply autonomous approval"],
            "businessObjectives": ["increase qualified demos"], "campaignObjectives": ["teach evidence-grounded operations"],
            "audiences": [{"id": "aud-founders", "name": "startup founders", "pains": ["content bottlenecks"]}],
            "funnelStage": "consideration", "intendedConversion": "request a product demo",
            "requestedChannels": ["x", "linkedin"], "supportedChannels": ["x"],
        }},
    }


def test_understand_persists_nimi_analysis_without_running_ryan(monkeypatch):
    calls, posts, returned = [], [], []
    async def fake_analyze(request, *, invocation):
        calls.append(request)
        value = job()["sourceAnalysis"]
        value["sourceDigest"] = request.sourceDigest
        value["moments"][0].update(
            startSec=0, endSec=5, quote="hello",
            sourceSegmentRefs=[request.sourceSegments[0].id],
        )
        result = SourceAnalysis.model_validate(value)
        returned.append(result.model_dump(mode="json", exclude_none=True))
        return AnalysisRunResult(
            analysis=result, searchEvidence={}, searchProvenance=None,
        )
    source = job()
    monkeypatch.setattr(stages, "get_job", lambda _id: source)
    monkeypatch.setattr(stages, "get_source_manifest", lambda _id: {"normalizedSources": [{"sourceId": "source-1", "sourceKind": "video", "title": "Demo", "contentDigest": "a" * 64, "segments": [{"id": "s1", "text": "hello", "digest": "b" * 64, "locator": {"kind": "time_range", "startMs": 0, "endMs": 5000}}]}]})
    monkeypatch.setattr(stages, "get_insights", lambda: {})
    monkeypatch.setattr(stages, "analyze_with_team", fake_analyze)
    monkeypatch.setattr(stages, "strategize_with_team", lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("Ryan ran during understand")))
    monkeypatch.setattr(stages, "web_post", lambda path, payload: posts.append((path, payload)))

    asyncio.run(stages.run_understand("job-1"))

    assert calls[0].sourceSegments[0].text == "hello"
    assert posts[0][0] == "/api/internal/analysis"
    assert "strategy" not in posts[0][1]
    assert posts[0][1]["analysis"] == returned[0]
    assert "visualHook" not in posts[0][1]["analysis"]["moments"][0]
    assert "cropSuitability" not in posts[0][1]["analysis"]["moments"][0]
    assert "captionSafeRegion" not in posts[0][1]["analysis"]["moments"][0]


def test_strategize_receives_typed_analysis_context_and_performance(monkeypatch):
    requests, posts = [], []
    async def fake_strategy(request, *, invocation, **_kwargs):
        requests.append((request, invocation))
        return StrategyRunResult(strategy=strategy(), searchEvidence={}, searchProvenance=None)
    async def fake_prepare(request, *, invocation):
        return request
    monkeypatch.setattr(stages, "get_job", lambda _id: job())
    monkeypatch.setattr(stages, "get_insights", lambda: {"topPosts": [{"postId": "post-1", "text": "Proof post", "likes": 12, "reposts": 3}]})
    monkeypatch.setattr(stages, "strategize_with_team", fake_strategy)
    monkeypatch.setattr(stages, "prepare_strategist_input", fake_prepare)
    monkeypatch.setattr(stages, "web_post", lambda path, payload: posts.append((path, payload)))

    asyncio.run(stages.run_strategize("job-1"))

    request, invocation = requests[0]
    assert request.analysis.moments[0].id == "m1"
    assert request.company.company == "Harmonia"
    assert request.campaign.horizonWeeks == 4
    assert request.performance[0].id == "performance:post-1"
    assert invocation.stage == "strategize"
    assert posts[0][0] == "/api/internal/strategy-context"
    assert posts[0][1]["sourceIds"] == ["a1", "m1", "segment-1"]
    assert posts[1][0] == "/api/internal/strategy"
    assert posts[1][1]["strategy"]["briefs"][0]["id"] == "brief-1"


def test_strategize_uses_current_durable_operation_for_managed_usage(monkeypatch):
    invocations = []

    async def fake_strategy(request, *, invocation, **_kwargs):
        invocations.append(invocation)
        return StrategyRunResult(strategy=strategy(), searchEvidence={}, searchProvenance=None)

    async def fake_prepare(request, *, invocation):
        return request

    monkeypatch.setattr(stages, "get_job", lambda _id: job())
    monkeypatch.setattr(stages, "get_insights", lambda: {})
    monkeypatch.setattr(stages, "strategize_with_team", fake_strategy)
    monkeypatch.setattr(stages, "prepare_strategist_input", fake_prepare)
    monkeypatch.setattr(stages, "web_post", lambda *_args: None)

    with operation_scope("job:job-1:stage:strategize:generation:4", 2):
        asyncio.run(stages.run_strategize("job-1"))

    assert invocations[0].operation_id == "job:job-1:stage:strategize:generation:4"


def test_strategize_persists_request_bound_search_evidence_and_provenance(monkeypatch):
    source = job()
    request = {"id": "research-current-market", "question": "What current public evidence describes governed content operations?", "justification": "Current external information is necessary."}
    source["config"]["strategyContext"]["researchRequest"] = request
    provenance = search_provenance({"url": "https://example.com/source", "title": "Primary source", "supportedText": "Supported text"})
    posts = []
    async def fake_strategy(_request, **_kwargs):
        return StrategyRunResult(
            strategy=strategy(),
            searchEvidence={"search-1": ("Supported text", "Primary source", "https://example.com/source")},
            searchProvenance=provenance,
        )
    async def fake_prepare(value, **_kwargs):
        return value
    monkeypatch.setattr(stages, "get_job", lambda _id: source)
    monkeypatch.setattr(stages, "get_insights", lambda: {})
    monkeypatch.setattr(stages, "prepare_strategist_input", fake_prepare)
    monkeypatch.setattr(stages, "strategize_with_team", fake_strategy)
    monkeypatch.setattr(stages, "web_post", lambda path, payload: posts.append((path, payload)))

    asyncio.run(stages.run_strategize("job-1"))
    assert posts[0][1]["researchRequest"] == request
    assert posts[1][1]["searchEvidence"][0]["evidenceId"] == "search-1"
    assert posts[1][1]["searchProvenance"] == provenance


def test_draft_requires_digest_bound_approved_strategy(monkeypatch):
    source = job()
    source.update({"contentStrategy": strategy().model_dump(mode="json"), "strategyDigest": "a" * 64,
                   "strategyApproval": {"decision": "approved", "payloadDigest": "b" * 64}})
    monkeypatch.setattr(stages, "get_job", lambda _id: source)
    monkeypatch.setattr(stages, "get_insights", lambda: {})
    try:
        asyncio.run(stages.run_draft("job-1"))
    except Exception as exc:
        assert "digest-bound approved strategy" in str(exc)
    else:
        raise AssertionError("Temi ran with mismatched strategy approval")


def test_draft_rejects_strategy_approval_decided_after_expiry(monkeypatch):
    source = job()
    source.update({"contentStrategy": strategy().model_dump(mode="json"), "strategyDigest": "a" * 64,
                   "strategyApproval": {"decision": "approved", "payloadDigest": "a" * 64,
                                        "decidedAt": datetime.now(UTC).isoformat(),
                                        "expiresAt": (datetime.now(UTC) - timedelta(minutes=1)).isoformat()}})
    monkeypatch.setattr(stages, "get_job", lambda _id: source)
    with pytest.raises(Exception, match="decided after expiry"):
        asyncio.run(stages.run_draft("job-1"))
