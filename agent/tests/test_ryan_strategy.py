"""Ryan's strict strategy contract and deterministic trust boundary."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from harmonia_agent.agent_models import (
    SourceAnalysis,
    AudienceSegment,
    CampaignContext,
    CompanyContext,
    ContentStrategy,
    MemoryFact,
    PerformanceObservation,
    StrategistInput,
)
from harmonia_agent.agents import AgentProtocolError, validate_strategy_grounding
from harmonia_agent.ryan_prompt import RYAN_STRATEGIST_INSTRUCTION


def strategist_input() -> StrategistInput:
    return StrategistInput(
        source_title="Activation interview",
        company=CompanyContext(
            evidenceId="ctx-company",
            company="Harmonia",
            product="A governed content engine",
            positioning="Evidence-grounded content operations",
            differentiators=["approval-bound effects"],
            brandVoice=["direct", "specific"],
            exclusions=["fabricated outcomes"],
            safetyConstraints=["never imply autonomous approval"],
        ),
        campaign=CampaignContext(
            evidenceId="ctx-campaign",
            businessObjectives=["increase qualified demos"],
            campaignObjectives=["teach evidence-grounded operations"],
            audiences=[AudienceSegment(id="aud-founders", name="startup founders", pains=["content bottlenecks"])],
            funnelStage="consideration",
            intendedConversion="request a product demo",
            requestedChannels=["x", "linkedin"],
            supportedChannels=["x"],
        ),
        analysis=SourceAnalysis.model_validate({
            "sourceDigest": "a" * 64,
            "summary": "Activation time fell.",
            "moments": [{"id": "m1", "title": "Activation", "startSec": 2, "endSec": 8, "hook": "Nine days to forty hours", "quote": "we cut nine days to forty hours", "sourceSegmentRefs": ["segment-1"], "visualEvidenceIds": [], "assumptions": [], "confidence": "high"}],
            "angles": [{"id": "a1", "angleType": "source_insight", "evidenceKind": "source", "title": "Operational speed", "rationale": "The source demonstrates a measurable operational improvement.", "evidenceRefs": ["m1"], "assumptions": [], "confidence": "high"}],
            "assumptions": [], "confidence": "high",
        }),
        performance=[PerformanceObservation(id="perf-1", summary="Proof-led posts earned more qualified replies", firestoreEvidenceRef="jobs/job-0/verifiedMetrics/perf-1")],
        memoryFacts=[MemoryFact(id="mem-1", content="Operators prefer quantified proof", firestoreEvidenceRef="jobs/job-0/learnings/mem-1")],
    )


def strategy(**updates) -> ContentStrategy:
    value = {
        "strategyId": "strategy-job-1-v1", "version": 1, "horizonWeeks": 4,
        "thesis": "Lead with verified operating proof.",
        "differentiatedNarrative": "Harmonia connects evidence to governed execution.",
        "objectives": [{"text": "Increase qualified demos", "evidenceRefs": ["ctx-campaign"]}],
        "audiencePriorities": [{"audienceId": "aud-founders", "priority": 1, "reason": "Founders own the bottleneck", "evidenceRefs": ["ctx-campaign"]}],
        "funnelIntent": "consideration", "intendedConversions": ["request a product demo"],
        "pillars": [{"name": "operational proof", "purpose": "Demonstrate measurable gains", "evidenceRefs": ["m1", "perf-1"]}],
        "campaignThemes": [{"name": "From delay to flow", "message": "Governance can accelerate delivery", "evidenceRefs": ["m1"]}],
        "channelRoles": [
            {"channel": "x", "role": "proof-led discovery", "operationallySupported": True, "formats": ["text_post"], "cadence": "2 posts per week", "evidenceRefs": ["ctx-campaign", "perf-1"]},
            {"channel": "linkedin", "role": "long-form consideration", "operationallySupported": False, "formats": ["text_post"], "cadence": "recommendation only", "evidenceRefs": ["ctx-campaign"]},
        ],
        "contentMix": [{"format": "text_post", "percentage": 100}],
        "cadenceGuidance": "Two supported-channel items per week.",
        "priorityRules": ["Prefer quantified source proof"],
        "ctaGuidance": ["Invite qualified operators to request a demo"],
        "kpis": [{"name": "qualified demo requests", "target": "measure weekly", "measurement": "verified attributed requests", "evidenceRefs": ["ctx-campaign"]}],
        "successCriteria": ["At least one verified qualified demo request"],
        "constraints": ["Use only supplied evidence"], "exclusions": ["Unsupported outcome claims"],
        "brandSafety": ["Never imply autonomous approval"],
        "briefs": [{
            "id": "brief-1", "title": "Nine days to forty hours", "objective": "Show operational proof",
            "audienceId": "aud-founders", "funnelStage": "consideration", "keyMessage": "Governed workflows reduce activation delay",
            "channelCandidates": ["x", "linkedin"], "formatCandidates": ["text_post"],
            "ctaIntent": "request a demo", "intendedConversion": "qualified demo request", "kpi": "qualified demo requests",
            "priority": 1, "dependencies": ["approved strategy"], "constraints": ["Quote the source exactly"],
            "evidenceRefs": ["m1", "ctx-campaign"],
        }],
        "assumptions": [{"text": "LinkedIn production is not currently supported", "evidenceRefs": ["ctx-campaign"], "confidence": "high"}],
        "confidence": "high",
    }
    value.update(updates)
    return ContentStrategy.model_validate(value)


def test_complete_grounded_strategy_is_accepted():
    result = validate_strategy_grounding(strategist_input(), strategy())
    assert result.horizonWeeks == 4
    assert result.channelRoles[1].operationallySupported is False


def test_strategy_accepts_source_segment_references_already_grounded_by_nimi():
    grounded_segment = strategy(briefs=[strategy().briefs[0].model_copy(update={
        "evidenceRefs": ["segment-1", "ctx-campaign"],
    })])
    assert validate_strategy_grounding(strategist_input(), grounded_segment) == grounded_segment

    invented_segment = strategy(briefs=[strategy().briefs[0].model_copy(update={
        "evidenceRefs": ["segment-2", "ctx-campaign"],
    })])
    with pytest.raises(AgentProtocolError, match="unknown evidence references.*segment-2"):
        validate_strategy_grounding(strategist_input(), invented_segment)


def test_strategist_input_defaults_to_four_weeks_and_requires_revision_feedback():
    assert strategist_input().campaign.horizonWeeks == 4
    with pytest.raises(ValidationError, match="revision feedback"):
        strategist_input().model_copy(update={"revision": 2, "revisionFeedback": ""}).model_validate(
            strategist_input().model_copy(update={"revision": 2, "revisionFeedback": ""}).model_dump()
        )


def test_strategy_rejects_invented_references_and_ungrounded_briefs():
    invalid = strategy(briefs=[strategy().briefs[0].model_copy(update={"evidenceRefs": ["invented"]})])
    with pytest.raises(AgentProtocolError, match="unknown evidence references.*invented"):
        validate_strategy_grounding(strategist_input(), invalid)

    source_free = strategy(briefs=[strategy().briefs[0].model_copy(update={"evidenceRefs": ["ctx-campaign"]})])
    with pytest.raises(AgentProtocolError, match="source evidence"):
        validate_strategy_grounding(strategist_input(), source_free)

    wrong_channel = strategy(briefs=[strategy().briefs[0].model_copy(update={"channelCandidates": ["youtube"]})])
    with pytest.raises(AgentProtocolError, match="unrequested channels"):
        validate_strategy_grounding(strategist_input(), wrong_channel)


def test_strategy_rejects_memory_as_authority_and_effect_language():
    overreach = strategy(priorityRules=["Memory mem-1 approved automatic publishing"])
    with pytest.raises(AgentProtocolError, match="authority overreach"):
        validate_strategy_grounding(strategist_input(), overreach)


def test_strategy_allows_descriptive_human_approval_receipt_and_verification_constraints():
    governed = strategy(
        constraints=[
            "Harmonia allows human operators to approve publishing; a receipt and independent verification are required after the effect executes.",
        ],
        priorityRules=["Prepare drafts autonomously while preserving the human approval boundary"],
    )

    assert validate_strategy_grounding(strategist_input(), governed) == governed


def test_strategy_rejects_performance_claim_without_verified_performance_reference():
    invalid = strategy(pillars=[strategy().pillars[0].model_copy(update={
        "purpose": "Repeat the prior high-performing approach",
        "evidenceRefs": ["m1"],
    })])
    with pytest.raises(AgentProtocolError, match="performance claim requires verified performance evidence"):
        validate_strategy_grounding(strategist_input(), invalid)


def test_strategy_allows_forward_looking_engagement_kpis_without_prior_performance_data():
    no_history = strategist_input().model_copy(update={"performance": []})
    baseline = strategy()
    forward_kpi = baseline.model_copy(update={
        "pillars": [baseline.pillars[0].model_copy(update={"evidenceRefs": ["m1"]})],
        "channelRoles": [role.model_copy(update={"evidenceRefs": ["ctx-campaign"]}) for role in baseline.channelRoles],
        "kpis": [baseline.kpis[0].model_copy(update={
            "name": "qualified engagement rate",
            "target": "establish a baseline during the first four weeks",
            "measurement": "measure verified engagement weekly",
            "evidenceRefs": ["ctx-campaign"],
        })],
    })

    assert validate_strategy_grounding(no_history, forward_kpi) == forward_kpi


def test_strategy_rejects_incoherent_thesis_final_copy_and_unexplained_high_confidence():
    incoherent = strategy(thesis="Own a completely unrelated category narrative.")
    with pytest.raises(AgentProtocolError, match="coherent thesis"):
        validate_strategy_grounding(strategist_input(), incoherent)

    final_copy = strategy(briefs=[strategy().briefs[0].model_copy(update={
        "keyMessage": "Buy now at https://example.com #startup",
    })])
    with pytest.raises(AgentProtocolError, match="final-copy-shaped"):
        validate_strategy_grounding(strategist_input(), final_copy)

    weak_input = strategist_input().model_copy(update={
        "analysis": strategist_input().analysis.model_copy(update={"confidence": "low"}),
    })
    with pytest.raises(AgentProtocolError, match="high confidence"):
        validate_strategy_grounding(weak_input, strategy())


def test_strategy_accepts_only_deterministically_validated_search_evidence():
    searched = strategy(pillars=[strategy().pillars[0].model_copy(update={
        "evidenceRefs": ["m1", "search-1"],
    })])
    with pytest.raises(AgentProtocolError, match="unknown evidence references"):
        validate_strategy_grounding(strategist_input(), searched)
    assert validate_strategy_grounding(
        strategist_input(), searched,
        research_evidence={"search-1": ("Supported text", "Primary source", "https://example.com/source")},
    ) == searched


def test_strategy_schema_rejects_incomplete_briefs_and_final_copy_fields():
    payload = strategy().model_dump(mode="json")
    del payload["briefs"][0]["ctaIntent"]
    with pytest.raises(ValidationError):
        ContentStrategy.model_validate(payload)

    payload = strategy().model_dump(mode="json")
    payload["briefs"][0]["finalPostCopy"] = "Buy now"
    with pytest.raises(ValidationError, match="extra_forbidden"):
        ContentStrategy.model_validate(payload)


def test_ryan_prompt_separates_temi_editorial_timing_from_external_scheduling():
    assert "Temi proposes editorial timing and publication windows" in RYAN_STRATEGIST_INSTRUCTION
    assert "deterministic code owns scheduling and external calendar effects" in RYAN_STRATEGIST_INSTRUCTION
    assert "Temi owns calendar dates" not in RYAN_STRATEGIST_INSTRUCTION


def test_ryan_prompt_uses_preloaded_skills_and_typed_session_input():
    assert "No skill-loading tool call is needed or available" in RYAN_STRATEGIST_INSTRUCTION
    assert "complete typed StrategistInput is already present in session state" in " ".join(RYAN_STRATEGIST_INSTRUCTION.split())
    assert "Never emit Markdown fences" in RYAN_STRATEGIST_INSTRUCTION
    assert "trailing commas" in RYAN_STRATEGIST_INSTRUCTION
