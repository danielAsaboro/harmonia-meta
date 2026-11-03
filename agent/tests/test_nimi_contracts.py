"""Strict contracts for Nimi's source-analysis boundary."""

import pytest
from pydantic import ValidationError

from harmonia_agent.agent_models import AnalystInput, SourceAnalysis
from harmonia_agent.nimi_prompt import NIMI_ANALYST_INSTRUCTION


def test_nimi_prompt_states_the_cross_field_confidence_invariant():
    assert "High confidence requires an empty assumptions list" in NIMI_ANALYST_INSTRUCTION


def test_nimi_prompt_reserves_clip_moments_for_timed_evidence():
    assert "When no time_range source segment exists, moments must be empty" in NIMI_ANALYST_INSTRUCTION


def analyst_input() -> dict:
    return {
        "sourceIds": ["source-1"],
        "sourceKind": "video",
        "sourceDigest": "a" * 64,
        "title": "Activation interview",
        "sourceSegments": [
            {"id": "segment-1", "sourceId": "source-1", "text": "We cut activation from nine days to forty hours.", "digest": "c" * 64, "locator": {"kind": "time_range", "startMs": 2000, "endMs": 8000}},
            {"id": "frame-1", "sourceId": "source-1", "text": "Founder points to the activation chart.", "digest": "b" * 64, "locator": {"kind": "frame", "timestampMs": 4000, "frameArtifactId": "frame-artifact-1"}},
        ],
        "performanceObservations": [{
            "id": "performance-1", "summary": "Verified proof posts earned qualified replies.",
            "firestoreEvidenceRef": "engagement/post-1",
        }],
        "memoryFacts": [{
            "id": "memory-1", "kind": "preference", "content": "Operators prefer concise proof.",
            "firestoreEvidenceRef": "jobs/job-0/learnings/memory-1",
        }],
        "researchRequest": None,
    }


def source_analysis() -> dict:
    return {
        "sourceDigest": "a" * 64,
        "summary": "The source provides a quantified activation result.",
        "moments": [{
            "id": "moment-1", "title": "Activation compression", "startSec": 2,
            "endSec": 8, "hook": "Nine days became forty hours",
            "quote": "We cut activation from nine days to forty hours.",
            "sourceSegmentRefs": ["segment-1"],
            "visualHook": "Founder points to the activation chart.",
            "cropSuitability": "good", "captionSafeRegion": "lower third",
            "visualEvidenceIds": ["frame-1"], "assumptions": [], "confidence": "high",
        }],
        "angles": [{
            "id": "angle-1", "angleType": "source_insight", "evidenceKind": "source", "title": "Compress time to value",
            "rationale": "Use the source's measured before-and-after result.",
            "evidenceRefs": ["moment-1", "segment-1"], "assumptions": [], "confidence": "high",
        }],
        "assumptions": [], "confidence": "high",
    }


def test_accepts_complete_typed_input_and_analysis():
    assert AnalystInput.model_validate(analyst_input()).sourceIds == ["source-1"]
    assert SourceAnalysis.model_validate(source_analysis()).angles[0].evidenceRefs == ["moment-1", "segment-1"]


def test_source_angle_accepts_complete_host_bound_source_package():
    value = source_analysis()
    value["angles"][0]["evidenceRefs"] = [f"segment-{index}" for index in range(1, 19)]

    assert len(SourceAnalysis.model_validate(value).angles[0].evidenceRefs) == 18


@pytest.mark.parametrize("field", ["sourceIds", "sourceKind", "sourceDigest", "title", "sourceSegments", "performanceObservations", "memoryFacts"])
def test_input_requires_every_typed_field(field):
    value = analyst_input()
    del value[field]
    with pytest.raises(ValidationError):
        AnalystInput.model_validate(value)


@pytest.mark.parametrize("field", ["sourceDigest", "summary", "moments", "angles", "assumptions", "confidence"])
def test_analysis_requires_every_output_field(field):
    value = source_analysis()
    del value[field]
    with pytest.raises(ValidationError):
        SourceAnalysis.model_validate(value)


def test_rejects_duplicate_segment_moment_and_angle_ids():
    value = analyst_input()
    value["sourceSegments"].append(dict(value["sourceSegments"][0]))
    with pytest.raises(ValidationError, match="segment ids must be unique"):
        AnalystInput.model_validate(value)
    output = source_analysis()
    output["moments"].append(dict(output["moments"][0]))
    with pytest.raises(ValidationError, match="moment ids must be unique"):
        SourceAnalysis.model_validate(output)
    output = source_analysis()
    output["angles"].append(dict(output["angles"][0]))
    with pytest.raises(ValidationError, match="angle ids must be unique"):
        SourceAnalysis.model_validate(output)


def test_rejects_invalid_ranges_digest_mismatch_and_visual_shape():
    value = analyst_input()
    value["sourceSegments"][0]["locator"]["endMs"] = 1000
    with pytest.raises(ValidationError, match="range end"):
        AnalystInput.model_validate(value)
    value = analyst_input()
    value["sourceSegments"][0]["sourceId"] = "invented"
    with pytest.raises(ValidationError, match="outside the manifest"):
        AnalystInput.model_validate(value)
    output = source_analysis()
    output["moments"][0]["visualHook"] = None
    with pytest.raises(ValidationError):
        SourceAnalysis.model_validate(output)


def test_rejects_coercion_and_extra_fields():
    value = source_analysis()
    value["confidence"] = 1
    with pytest.raises(ValidationError):
        SourceAnalysis.model_validate(value)
    value = analyst_input()
    value["prior_learnings"] = "legacy prose"
    with pytest.raises(ValidationError):
        AnalystInput.model_validate(value)
