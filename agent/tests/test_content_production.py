import pytest

from harmonia_agent.content_artifacts import ArtifactProductionInput, ArtifactReviewBatch, ProductionBatch
from harmonia_agent.content_production import finalize_production
from tests.test_content_artifacts import newsletter


def batch():
    return ProductionBatch.model_validate({"artifacts": [newsletter()]})


def review(decision="accept"):
    checks = [{"kind": kind, "passed": decision == "accept", "note": "Pass" if decision == "accept" else "Fix"} for kind in ["grounding", "brief", "brand", "format", "cta", "safety", "clarity"]]
    return ArtifactReviewBatch.model_validate({"reviews": [{"artifactId": "artifact-newsletter", "decision": decision, "checks": checks, "issues": [] if decision == "accept" else [{"id": "i1", "check": "grounding", "instruction": "Use the supplied proof."}]}]})


def test_accepts_original_when_every_exact_artifact_passes_review():
    result = finalize_production(original=batch(), first_review=review(), revision=None, final_review=None, evidence_refs=["source-1:seg-1"], output_plan_item_ids=["output-1-newsletter"])
    assert result.accepted.artifacts[0].id == "artifact-newsletter"
    assert result.revision is None


def test_requires_exactly_one_issue_bound_revision_after_revise():
    with pytest.raises(ValueError, match="revision is required"):
        finalize_production(original=batch(), first_review=review("revise"), revision=None, final_review=None, evidence_refs=["source-1:seg-1"], output_plan_item_ids=["output-1-newsletter"])
    result = finalize_production(original=batch(), first_review=review("revise"), revision=batch(), final_review=review(), evidence_refs=["source-1:seg-1"], output_plan_item_ids=["output-1-newsletter"])
    assert result.accepted == result.revision


def test_rejects_second_revise_without_a_third_model_pass():
    with pytest.raises(ValueError, match="operator attention"):
        finalize_production(original=batch(), first_review=review("revise"), revision=batch(), final_review=review("revise"), evidence_refs=["source-1:seg-1"], output_plan_item_ids=["output-1-newsletter"])


def test_production_input_binds_requested_outputs_to_supplied_evidence():
    value = {"outputPlanId": "plan-1", "outputPlanDigest": "a" * 64, "requests": [{"id": "output-1-newsletter", "outputType": "newsletter", "evidenceRefs": ["source-1:seg-1"]}], "evidence": [{"id": "source-1:seg-1", "text": "Proof"}], "brandContext": "Concise and factual", "constraints": [], "passType": "original", "priorBatch": None, "priorReview": None}
    assert ArtifactProductionInput.model_validate(value).requests[0].outputType == "newsletter"
    value["requests"][0]["evidenceRefs"] = ["invented"]
    with pytest.raises(ValueError, match="supplied evidence"):
        ArtifactProductionInput.model_validate(value)
