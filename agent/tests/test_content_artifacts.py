import pytest
from pydantic import ValidationError

from harmonia_agent.content_artifacts import (
    ArtifactRequest,
    ArtifactReviewBatch,
    ContentArtifactDraft,
    ProductionBatch,
    SemanticArtifactDraft,
    SemanticArtifactWireDraft,
    SemanticArtifactReview,
    assemble_content_pack_draft,
    materialize_semantic_artifact,
    parse_semantic_artifact_wire,
    semantic_payload_contract,
    materialize_artifact_review,
)


def newsletter():
    return {
        "id": "artifact-newsletter", "outputPlanItemId": "output-1-newsletter",
        "outputType": "newsletter", "title": "Launch note",
        "sourceSegmentRefs": ["source-1:seg-1"],
        "payload": {"kind": "newsletter", "subject": "Launch", "preheader": "What changed", "introduction": "Intro", "sections": [{"id": "s1", "heading": "Proof", "body": "Body", "sourceSegmentRefs": ["source-1:seg-1"]}], "cta": "Try it"},
    }


def test_accepts_strict_multiformat_batch_and_preserves_requested_order():
    batch = ProductionBatch.model_validate({"artifacts": [newsletter()]})
    assert batch.artifacts[0].outputType == "newsletter"


def test_rejects_payload_mismatch_duplicate_sections_and_unknown_evidence():
    value = newsletter(); value["outputType"] = "blog_article"
    with pytest.raises(ValidationError, match="payload kind"):
        ContentArtifactDraft.model_validate(value)
    value = newsletter(); value["payload"]["sections"].append(dict(value["payload"]["sections"][0]))
    with pytest.raises(ValidationError, match="section ids"):
        ContentArtifactDraft.model_validate(value)
    batch = ProductionBatch.model_validate({"artifacts": [newsletter()]})
    with pytest.raises(ValueError, match="outside supplied evidence"):
        batch.validate_against(["source-2:seg-9"], ["output-1-newsletter"])


def test_rejects_missing_or_unrequested_plan_outputs():
    batch = ProductionBatch.model_validate({"artifacts": [newsletter()]})
    with pytest.raises(ValueError, match="output plan coverage"):
        batch.validate_against(["source-1:seg-1"], ["output-1-newsletter", "output-2-caption"])


@pytest.mark.parametrize("output_type,payload", [
    ("x_post", {"kind": "x_post", "text": "Proof"}),
    ("linkedin_post", {"kind": "linkedin_post", "body": "Proof", "cta": "Try it"}),
    ("caption", {"kind": "caption", "platformIntent": "instagram", "text": "Proof", "hashtags": ["#launch"]}),
    ("x_thread", {"kind": "x_thread", "posts": [{"id": "p1", "text": "One", "sourceSegmentRefs": ["source-1:seg-1"]}, {"id": "p2", "text": "Two", "sourceSegmentRefs": ["source-1:seg-1"]}]}),
    ("blog_article", {"kind": "blog_article", "headline": "Proof", "dek": "Why it matters", "sections": [{"id": "s1", "heading": "Result", "body": "Proof", "sourceSegmentRefs": ["source-1:seg-1"]}], "conclusion": "Conclusion", "cta": "Try it", "citations": ["source-1:seg-1"]}),
    ("carousel_spec", {"kind": "carousel_spec", "title": "Proof", "slides": [{"id": "s1", "headline": "Open", "body": "Proof", "sourceSegmentRefs": ["source-1:seg-1"], "role": "opening"}, {"id": "s2", "headline": "Act", "body": "Try it", "sourceSegmentRefs": ["source-1:seg-1"], "role": "cta"}]}),
    ("quote_card", {"kind": "quote_card", "quote": "Proof", "attribution": "Founder", "sourceSegmentRef": "source-1:seg-1", "renderBrief": "Editorial card"}),
    ("diagram", {"kind": "diagram", "diagramType": "flow", "nodes": [{"id": "n1", "label": "Input", "sourceSegmentRefs": ["source-1:seg-1"]}], "edges": [], "renderBrief": "Simple flow"}),
    ("editorial_calendar", {"kind": "editorial_calendar", "entries": [{"id": "e1", "artifactId": "artifact-1", "channel": "x", "intendedAt": "2026-08-31T10:00:00Z", "purpose": "Launch", "dependencyArtifactIds": []}]}),
    ("content_pack", {"kind": "content_pack", "artifacts": [{"artifactId": "artifact-1", "digest": "0" * 64}]}),
])
def test_accepts_each_registered_text_artifact_shape(output_type, payload):
    value = newsletter()
    value.update(outputType=output_type, payload=payload)
    assert ContentArtifactDraft.model_validate(value).payload.kind == output_type


def test_enforces_thread_limits_and_nested_evidence():
    value = newsletter(); value.update(outputType="x_thread", payload={"kind": "x_thread", "posts": [{"id": "p1", "text": "x" * 281, "sourceSegmentRefs": ["source-1:seg-1"]}, {"id": "p2", "text": "Two", "sourceSegmentRefs": ["source-1:seg-1"]}]})
    with pytest.raises(ValidationError):
        ContentArtifactDraft.model_validate(value)


def test_review_batch_binds_every_exact_artifact_and_rejects_missing_checks():
    reviews = ArtifactReviewBatch.model_validate({"reviews": [{
        "artifactId": "artifact-newsletter", "decision": "accept",
        "checks": [{"kind": kind, "passed": True, "note": "Pass"} for kind in ["grounding", "brief", "brand", "format", "cta", "safety", "clarity"]],
        "issues": [],
    }]})
    assert reviews.accepted_ids(["artifact-newsletter"]) == ["artifact-newsletter"]
    value = reviews.model_dump(mode="json"); value["reviews"][0]["checks"][-1] = dict(value["reviews"][0]["checks"][0])
    with pytest.raises(ValidationError, match="exactly once"):
        ArtifactReviewBatch.model_validate(value)


def test_host_assigns_artifact_identity_after_semantic_generation():
    request = ArtifactRequest.model_validate({
        "id": "output-1-linkedin_post",
        "outputType": "linkedin_post",
        "evidenceRefs": ["source-1:seg-1"],
    })
    semantic = SemanticArtifactDraft.model_validate({
        "title": "Founder lesson",
        "sourceSegmentRefs": ["source-1:seg-1"],
        "payload": {"kind": "linkedin_post", "body": "Proof from the source."},
    })

    artifact = materialize_semantic_artifact(request, semantic)

    assert artifact.id == "artifact-output-1-linkedin_post"
    assert artifact.outputPlanItemId == request.id
    assert artifact.outputType == request.outputType


def test_model_cannot_supply_artifact_identifiers_or_pack_digests():
    with pytest.raises(ValidationError, match="extra"):
        SemanticArtifactDraft.model_validate({
            "id": "invented",
            "title": "Pack",
            "sourceSegmentRefs": ["source-1:seg-1"],
            "payload": {"kind": "content_pack", "artifacts": [{
                "artifactId": "invented", "digest": "f" * 64,
            }]},
        })


def test_host_assembles_pack_membership_with_unresolved_digest_markers():
    child = ContentArtifactDraft.model_validate(newsletter())
    request = ArtifactRequest.model_validate({
        "id": "output-2-content_pack", "outputType": "content_pack",
        "evidenceRefs": ["source-1:seg-1"],
    })

    pack = assemble_content_pack_draft(request, [child])

    assert pack.id == "artifact-output-2-content_pack"
    assert pack.payload.artifacts[0].artifactId == child.id
    assert pack.payload.artifacts[0].digest == "0" * 64


def test_host_parses_wire_payload_against_only_the_authorized_format():
    request = ArtifactRequest.model_validate({
        "id": "output-1-linkedin_post", "outputType": "linkedin_post",
        "evidenceRefs": ["source-1:seg-1"],
    })
    wire = SemanticArtifactWireDraft.model_validate({
        "title": "Founder lesson", "sourceSegmentRefs": ["source-1:seg-1"],
        "payloadJson": '{"kind":"linkedin_post","body":"Proof."}',
    })

    assert parse_semantic_artifact_wire(request, wire).payload.kind == "linkedin_post"

    wrong = wire.model_copy(update={
        "payloadJson": '{"kind":"quote_card","quote":"Proof","attribution":"Sintel","sourceSegmentRef":"source-1:seg-1","renderBrief":"Card"}',
    })
    with pytest.raises(ValidationError):
        parse_semantic_artifact_wire(request, wrong)


def test_host_supplies_the_exact_authorized_payload_contract():
    contract = semantic_payload_contract("linkedin_post")

    assert "body" in contract["properties"]
    assert "text" not in contract["properties"]
    assert contract["properties"]["kind"]["const"] == "linkedin_post"


def test_host_assigns_review_and_issue_identifiers():
    semantic = SemanticArtifactReview.model_validate({
        "decision": "revise",
        "checks": [
            {"kind": kind, "passed": kind != "clarity", "note": "Checked"}
            for kind in ["grounding", "brief", "brand", "format", "cta", "safety", "clarity"]
        ],
        "issues": [{"check": "clarity", "instruction": "State the lesson directly."}],
    })

    review = materialize_artifact_review("artifact-output-1-linkedin_post", semantic)

    assert review.artifactId == "artifact-output-1-linkedin_post"
    assert review.issues[0].id == "issue-artifact-output-1-linkedin_post-1"
