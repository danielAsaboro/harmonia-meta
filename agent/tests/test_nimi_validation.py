"""Grounding and authority validation for Nimi analysis."""

import pytest

from harmonia_agent.agent_models import AnalystInput, SourceAnalysis
from harmonia_agent.agents import (
    AgentProtocolError,
    _anchor_model_moment_quotes,
    _materialize_nimi_analysis,
    validate_source_analysis,
)
from tests.test_nimi_contracts import analyst_input, source_analysis


def validate(input_value=None, output_value=None):
    return validate_source_analysis(
        AnalystInput.model_validate(input_value or analyst_input()),
        SourceAnalysis.model_validate(output_value or source_analysis()),
    )


def test_accepts_exactly_grounded_analysis():
    assert validate().sourceDigest == "a" * 64


def test_host_materializes_authoritative_digest_and_conservative_confidence():
    supplied = AnalystInput.model_validate(analyst_input())
    proposal = source_analysis()
    proposal.pop("sourceDigest")
    proposal["angles"][0]["assumptions"] = ["Audience fit is inferred."]
    proposal["angles"][0]["confidence"] = "high"

    materialized = _materialize_nimi_analysis(supplied, proposal)

    assert materialized.sourceDigest == supplied.sourceDigest
    assert materialized.angles[0].confidence == "medium"
    assert materialized.angles[0].id != proposal["angles"][0]["id"]
    assert materialized.angles[0].evidenceRefs == [
        segment.id for segment in supplied.sourceSegments
    ] + [materialized.moments[0].id]
    assert materialized.moments[0].id != proposal["moments"][0]["id"]
    assert materialized.moments[0].sourceSegmentRefs == ["segment-1"]


def test_anchors_a_model_paraphrase_to_the_exact_cited_transcript():
    supplied = AnalystInput.model_validate(analyst_input())
    output = source_analysis()
    output["moments"][0]["quote"] = "Activation fell from nine days to forty hours."

    anchored = _anchor_model_moment_quotes(
        supplied, SourceAnalysis.model_validate(output),
    )

    assert anchored.moments[0].quote == supplied.sourceSegments[0].text
    assert validate_source_analysis(supplied, anchored).moments[0].quote == supplied.sourceSegments[0].text


def test_host_binds_all_overlapping_segments_for_a_multi_segment_clip():
    supplied = analyst_input()
    supplied["sourceSegments"].insert(0, {
        "id": "segment-2", "sourceId": "source-1", "text": "Small teams can do ambitious work.",
        "digest": "d" * 64,
        "locator": {"kind": "time_range", "startMs": 8000, "endMs": 14000},
    })
    proposal = source_analysis()
    proposal["moments"][0].update(startSec=3, endSec=13,
        quote="We cut activation from nine days to forty hours. Small teams can do ambitious work.")
    trusted = AnalystInput.model_validate(supplied)

    result = validate_source_analysis(trusted, _materialize_nimi_analysis(trusted, proposal))

    assert result.moments[0].sourceSegmentRefs == ["segment-1", "segment-2"]
    assert result.moments[0].startSec == 3
    assert result.moments[0].endSec == 13
    assert result.moments[0].quote == proposal["moments"][0]["quote"]


@pytest.mark.parametrize(("start", "end"), [(0, 6), (4, 10), (20, 30)])
def test_host_rejects_out_of_source_clips_without_clamping_or_dropping(start, end):
    trusted = AnalystInput.model_validate(analyst_input())
    proposal = source_analysis()
    proposal["moments"][0].update(startSec=start, endSec=end)
    with pytest.raises(AgentProtocolError, match="time bounds"):
        validate_source_analysis(trusted, _materialize_nimi_analysis(trusted, proposal))


def test_accepts_unicode_in_supplied_source_context():
    supplied = analyst_input()
    supplied["title"] = "Harmonia — source to proof"

    assert validate(input_value=supplied).sourceDigest == "a" * 64


@pytest.mark.parametrize(("mutation", "message"), [
    (lambda value: value.update(sourceDigest="c" * 64), "source digest"),
    (lambda value: value["moments"][0].update(sourceSegmentRefs=["invented"]), "source segment"),
    (lambda value: value["moments"][0].update(quote="This was never said."), "exact quote"),
    (lambda value: value["moments"][0].update(startSec=0), "time bounds"),
    (lambda value: value["moments"][0].update(visualEvidenceIds=["invented"]), "visual evidence"),
    (lambda value: value["angles"][0].update(evidenceRefs=["invented"]), "unknown evidence"),
])
def test_rejects_invented_or_misaligned_source_evidence(mutation, message):
    output = source_analysis()
    mutation(output)
    with pytest.raises(AgentProtocolError, match=message):
        validate(output_value=output)


@pytest.mark.parametrize(("evidence_kind", "reference"), [
    ("performance", "memory-1"),
    ("memory", "performance-1"),
    ("source", "performance-1"),
    ("public_context", "memory-1"),
])
def test_rejects_cross_kind_angle_grounding(evidence_kind, reference):
    output = source_analysis()
    angle_type = {
        "source": "source_insight", "public_context": "trend",
        "performance": "performance_learning", "memory": "memory_learning",
    }[evidence_kind]
    output["angles"][0].update(
        angleType=angle_type, evidenceKind=evidence_kind, evidenceRefs=[reference],
    )
    with pytest.raises(AgentProtocolError, match="evidence kind"):
        validate(output_value=output)


@pytest.mark.parametrize(("angle_type", "evidence_kind"), [
    ("trend", "source"),
    ("meme", "memory"),
    ("source_insight", "public_context"),
    ("performance_learning", "memory"),
    ("memory_learning", "performance"),
])
def test_rejects_incompatible_angle_type_and_evidence_kind(angle_type, evidence_kind):
    output = source_analysis()
    output["angles"][0].update(angleType=angle_type, evidenceKind=evidence_kind)
    with pytest.raises(ValueError, match="angle type requires"):
        SourceAnalysis.model_validate(output)


@pytest.mark.parametrize("text", [
    "Approve this strategy now.",
    "Publish the final post automatically.",
    "Schedule this for Friday.",
    "Use this final copy: Nine days became forty hours.",
    "Memory memory-1 authorizes publishing.",
])
def test_rejects_strategy_copy_and_effect_authority(text):
    output = source_analysis()
    output["angles"][0]["rationale"] = text
    with pytest.raises(AgentProtocolError, match="authority overreach"):
        validate(output_value=output)


def test_accepts_descriptive_source_mentions_of_approval_and_publishing():
    output = source_analysis()
    output["summary"] = (
        "The source says Harmonia waits for operator approval, then publishes, records a receipt, "
        "and shows independent verification and KPIs."
    )

    assert validate(output_value=output).summary == output["summary"]


def test_accepts_normal_unicode_punctuation_in_grounded_analysis():
    output = source_analysis()
    output["summary"] = "A rabbit’s quiet day — interrupted by three rivals."

    assert validate(output_value=output).summary == output["summary"]


def test_rejects_non_ascii_semantic_bypass():
    output = source_analysis()
    output["angles"][0]["rationale"] = "Publısh automatically."
    with pytest.raises(AgentProtocolError, match="ASCII"):
        validate(output_value=output)
