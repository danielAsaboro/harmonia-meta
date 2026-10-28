"""Strict authority-free drafts and immutable host-sealed content artifacts."""

import hashlib
import json
from typing import Annotated, Literal
from pydantic import Field, field_validator, model_validator
from .agent_models import StrictModel


class Section(StrictModel):
    id: str = Field(min_length=1)
    heading: str = Field(min_length=1)
    body: str = Field(min_length=1)
    sourceSegmentRefs: list[str] = Field(min_length=1, max_length=100)


class NewsletterPayload(StrictModel):
    kind: Literal["newsletter"]
    subject: str = Field(min_length=1, max_length=200)
    preheader: str = Field(min_length=1, max_length=300)
    introduction: str = Field(min_length=1)
    sections: list[Section] = Field(min_length=1, max_length=30)
    cta: str = Field(min_length=1)
    signOff: str | None = None

    @model_validator(mode="after")
    def unique_sections(self):
        if len({item.id for item in self.sections}) != len(self.sections):
            raise ValueError("section ids must be unique")
        return self


class XPostPayload(StrictModel):
    kind: Literal["x_post"]
    text: str = Field(min_length=1, max_length=280)

class LinkedInPayload(StrictModel):
    kind: Literal["linkedin_post"]
    body: str = Field(min_length=1, max_length=3_000)
    title: str | None = Field(default=None, max_length=200)
    cta: str | None = Field(default=None, max_length=500)

class CaptionPayload(StrictModel):
    kind: Literal["caption"]
    platformIntent: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=3_000)
    cta: str | None = None
    hashtags: list[str] = Field(default_factory=list, max_length=30)

class ThreadPost(StrictModel):
    id: str = Field(min_length=1)
    text: str = Field(min_length=1, max_length=280)
    sourceSegmentRefs: list[str] = Field(min_length=1)

class ThreadPayload(StrictModel):
    kind: Literal["x_thread"]
    posts: list[ThreadPost] = Field(min_length=2, max_length=25)

class BlogPayload(StrictModel):
    kind: Literal["blog_article"]
    headline: str = Field(min_length=1)
    dek: str = Field(min_length=1)
    sections: list[Section] = Field(min_length=1)
    conclusion: str = Field(min_length=1)
    cta: str = Field(min_length=1)
    citations: list[str] = Field(min_length=1)

class Slide(StrictModel):
    id: str = Field(min_length=1)
    headline: str = Field(min_length=1)
    body: str = Field(min_length=1)
    sourceSegmentRefs: list[str] = Field(min_length=1)
    role: Literal["opening", "content", "cta"]

class CarouselPayload(StrictModel):
    kind: Literal["carousel_spec"]
    title: str = Field(min_length=1)
    slides: list[Slide] = Field(min_length=2, max_length=20)

class QuoteCardPayload(StrictModel):
    kind: Literal["quote_card"]
    quote: str = Field(min_length=1)
    attribution: str = Field(min_length=1)
    sourceSegmentRef: str = Field(min_length=3)
    renderBrief: str = Field(min_length=1)

class DiagramNode(StrictModel):
    id: str = Field(min_length=1)
    label: str = Field(min_length=1)
    sourceSegmentRefs: list[str] = Field(min_length=1)

class DiagramEdge(StrictModel):
    from_: str = Field(alias="from", min_length=1)
    to: str = Field(min_length=1)
    label: str | None = None
    sourceSegmentRefs: list[str] = Field(min_length=1)

class DiagramPayload(StrictModel):
    kind: Literal["diagram"]
    diagramType: Literal["flow", "comparison", "timeline", "hierarchy"]
    nodes: list[DiagramNode] = Field(min_length=1)
    edges: list[DiagramEdge] = Field(default_factory=list)
    renderBrief: str = Field(min_length=1)

class CalendarEntry(StrictModel):
    id: str = Field(min_length=1)
    artifactId: str = Field(min_length=1)
    channel: str = Field(min_length=1)
    intendedAt: str = Field(min_length=1)
    purpose: str = Field(min_length=1)
    dependencyArtifactIds: list[str] = Field(default_factory=list)

    @field_validator("intendedAt")
    @classmethod
    def valid_timestamp(cls, value: str) -> str:
        from datetime import datetime

        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value

class CalendarPayload(StrictModel):
    kind: Literal["editorial_calendar"]
    entries: list[CalendarEntry] = Field(min_length=1)

class PackItem(StrictModel):
    artifactId: str = Field(min_length=1)
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")

class PackPayload(StrictModel):
    kind: Literal["content_pack"]
    artifacts: list[PackItem] = Field(min_length=1)


ArtifactPayload = Annotated[XPostPayload | ThreadPayload | LinkedInPayload | BlogPayload | NewsletterPayload | CaptionPayload | CarouselPayload | QuoteCardPayload | DiagramPayload | CalendarPayload | PackPayload, Field(discriminator="kind")]
GenerativeArtifactPayload = Annotated[
    XPostPayload | ThreadPayload | LinkedInPayload | BlogPayload | NewsletterPayload
    | CaptionPayload | CarouselPayload | QuoteCardPayload | DiagramPayload,
    Field(discriminator="kind"),
]


class SemanticArtifactDraft(StrictModel):
    """Model-authored meaning only; identity and digests are host authority."""

    title: str = Field(min_length=1, max_length=300)
    sourceSegmentRefs: list[str] = Field(min_length=1, max_length=100)
    payload: GenerativeArtifactPayload


class SemanticArtifactWireDraft(StrictModel):
    """Provider-compatible envelope; payload is parsed by the host's exact schema."""

    title: str = Field(min_length=1, max_length=300)
    sourceSegmentRefs: list[str] = Field(min_length=1, max_length=100)
    payloadJson: str = Field(min_length=2, max_length=30_000)


class ContentArtifactDraft(StrictModel):
    id: str = Field(min_length=1, max_length=200)
    outputPlanItemId: str = Field(min_length=1, max_length=200)
    outputType: Literal["x_post", "x_thread", "linkedin_post", "blog_article", "newsletter", "caption", "carousel_spec", "quote_card", "diagram", "editorial_calendar", "content_pack"]
    title: str = Field(min_length=1, max_length=300)
    sourceSegmentRefs: list[str] = Field(min_length=1, max_length=100)
    payload: ArtifactPayload

    @model_validator(mode="after")
    def matching_kind(self):
        if self.outputType != self.payload.kind:
            raise ValueError("payload kind must match output type")
        if isinstance(self.payload, PackPayload) and any(
            item.digest != "0" * 64 for item in self.payload.artifacts
        ):
            raise ValueError("draft content-pack digests must use the host-seal marker")
        return self


class ArtifactProducer(StrictModel):
    role: str = Field(min_length=1)
    model: str = Field(min_length=1)
    traceId: str = Field(pattern=r"^[0-9a-f]{32}$")


class ArtifactReviewIdentity(StrictModel):
    role: str = Field(min_length=1)
    traceId: str = Field(pattern=r"^[0-9a-f]{32}$")
    decision: Literal["accept"]


class ContentArtifactRecord(StrictModel):
    """Exact immutable artifact envelope sealed by the TypeScript authority boundary."""

    id: str = Field(min_length=1)
    jobId: str = Field(min_length=1)
    outputPlanId: str = Field(min_length=1)
    outputPlanDigest: str = Field(pattern=r"^[0-9a-f]{64}$")
    outputType: Literal["x_post", "x_thread", "linkedin_post", "blog_article", "newsletter", "caption", "carousel_spec", "quote_card", "diagram", "editorial_calendar", "content_pack"]
    revision: int = Field(gt=0)
    title: str = Field(min_length=1, max_length=300)
    sourceSegmentRefs: list[str] = Field(min_length=1, max_length=100)
    producer: ArtifactProducer
    review: ArtifactReviewIdentity
    mimeType: Literal["text/markdown", "application/json"]
    createdAt: str = Field(min_length=1)
    payload: ArtifactPayload
    contentDigest: str = Field(pattern=r"^[0-9a-f]{64}$")

    @field_validator("createdAt")
    @classmethod
    def valid_created_at(cls, value: str) -> str:
        from datetime import datetime

        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value

    @model_validator(mode="after")
    def validate_identity(self):
        if self.outputType != self.payload.kind:
            raise ValueError("payload kind must match output type")
        value = self.model_dump(mode="json", by_alias=True, exclude_none=True)
        digest = value.pop("contentDigest")
        canonical = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()
        if hashlib.sha256(canonical).hexdigest() != digest:
            raise ValueError("content artifact canonical digest mismatch")
        return self


class ProductionBatch(StrictModel):
    artifacts: list[ContentArtifactDraft] = Field(min_length=1, max_length=30)

    def validate_against(self, evidence_refs: list[str], output_plan_item_ids: list[str]):
        actual = [item.outputPlanItemId for item in self.artifacts]
        if actual != output_plan_item_ids:
            raise ValueError("output plan coverage must be exact and ordered")
        allowed = set(evidence_refs)
        if any(ref not in allowed for item in self.artifacts for ref in item.sourceSegmentRefs):
            raise ValueError("artifact evidence is outside supplied evidence")
        return self


class ArtifactReviewCheck(StrictModel):
    kind: Literal["grounding", "brief", "brand", "format", "cta", "safety", "clarity"]
    passed: bool
    note: str = Field(min_length=1, max_length=600)


class ArtifactReviewIssue(StrictModel):
    id: str = Field(min_length=1)
    check: Literal["grounding", "brief", "brand", "format", "cta", "safety", "clarity"]
    instruction: str = Field(min_length=1, max_length=600)


class SemanticArtifactReviewIssue(StrictModel):
    check: Literal["grounding", "brief", "brand", "format", "cta", "safety", "clarity"]
    instruction: str = Field(min_length=1, max_length=600)


class SemanticArtifactReview(StrictModel):
    decision: Literal["accept", "revise"]
    checks: list[ArtifactReviewCheck] = Field(min_length=7, max_length=7)
    issues: list[SemanticArtifactReviewIssue] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def complete_review(self):
        required = {"grounding", "brief", "brand", "format", "cta", "safety", "clarity"}
        if {check.kind for check in self.checks} != required:
            raise ValueError("each editorial check must appear exactly once")
        if self.decision == "accept" and (self.issues or not all(check.passed for check in self.checks)):
            raise ValueError("accepted artifact cannot retain failed checks or issues")
        if self.decision == "revise" and not self.issues:
            raise ValueError("revise decision requires actionable issues")
        return self


class ArtifactReview(StrictModel):
    artifactId: str = Field(min_length=1)
    decision: Literal["accept", "revise"]
    checks: list[ArtifactReviewCheck] = Field(min_length=7, max_length=7)
    issues: list[ArtifactReviewIssue] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def complete_review(self):
        required = {"grounding", "brief", "brand", "format", "cta", "safety", "clarity"}
        if {check.kind for check in self.checks} != required:
            raise ValueError("each editorial check must appear exactly once")
        if self.decision == "accept" and (self.issues or not all(check.passed for check in self.checks)):
            raise ValueError("accepted artifact cannot retain failed checks or issues")
        if self.decision == "revise" and not self.issues:
            raise ValueError("revise decision requires actionable issues")
        return self


def materialize_artifact_review(
    artifact_id: str, semantic: SemanticArtifactReview,
) -> ArtifactReview:
    return ArtifactReview(
        artifactId=artifact_id,
        decision=semantic.decision,
        checks=semantic.checks,
        issues=[
            ArtifactReviewIssue(
                id=f"issue-{artifact_id}-{index}",
                check=issue.check,
                instruction=issue.instruction,
            )
            for index, issue in enumerate(semantic.issues, start=1)
        ],
    )


class ArtifactReviewBatch(StrictModel):
    reviews: list[ArtifactReview] = Field(min_length=1, max_length=30)

    def accepted_ids(self, artifact_ids: list[str]) -> list[str]:
        if [review.artifactId for review in self.reviews] != artifact_ids:
            raise ValueError("review coverage must exactly match artifact order")
        return [review.artifactId for review in self.reviews if review.decision == "accept"]


class ArtifactEvidence(StrictModel):
    id: str = Field(min_length=3)
    text: str = Field(min_length=1, max_length=20_000)


class ArtifactRequest(StrictModel):
    id: str = Field(min_length=1)
    outputType: Literal["x_post", "x_thread", "linkedin_post", "blog_article", "newsletter", "caption", "carousel_spec", "quote_card", "diagram", "editorial_calendar", "content_pack"]
    evidenceRefs: list[str] = Field(min_length=1, max_length=100)


_GENERATIVE_PAYLOAD_MODELS = {
    "x_post": XPostPayload,
    "x_thread": ThreadPayload,
    "linkedin_post": LinkedInPayload,
    "blog_article": BlogPayload,
    "newsletter": NewsletterPayload,
    "caption": CaptionPayload,
    "carousel_spec": CarouselPayload,
    "quote_card": QuoteCardPayload,
    "diagram": DiagramPayload,
}


def semantic_payload_contract(output_type: str) -> dict:
    model = _GENERATIVE_PAYLOAD_MODELS.get(output_type)
    if model is None:
        raise ValueError("deterministic artifacts have no model payload contract")
    return model.model_json_schema()


def parse_semantic_artifact_wire(
    request: ArtifactRequest, wire: SemanticArtifactWireDraft,
) -> SemanticArtifactDraft:
    model = _GENERATIVE_PAYLOAD_MODELS.get(request.outputType)
    if model is None:
        raise ValueError("deterministic artifacts cannot be model-authored")
    payload = model.model_validate_json(wire.payloadJson)
    return SemanticArtifactDraft(
        title=wire.title,
        sourceSegmentRefs=wire.sourceSegmentRefs,
        payload=payload,
    )


def materialize_semantic_artifact(
    request: ArtifactRequest, semantic: SemanticArtifactDraft,
) -> ContentArtifactDraft:
    if request.outputType in {"editorial_calendar", "content_pack"}:
        raise ValueError("deterministic artifacts must be assembled by the host")
    if semantic.payload.kind != request.outputType:
        raise ValueError("semantic payload kind must match the authorized output request")
    if any(reference not in request.evidenceRefs for reference in semantic.sourceSegmentRefs):
        raise ValueError("semantic artifact references evidence outside its authorized request")
    return ContentArtifactDraft(
        id=f"artifact-{request.id}",
        outputPlanItemId=request.id,
        outputType=request.outputType,
        title=semantic.title,
        sourceSegmentRefs=semantic.sourceSegmentRefs,
        payload=semantic.payload,
    )


def assemble_content_pack_draft(
    request: ArtifactRequest, children: list[ContentArtifactDraft],
) -> ContentArtifactDraft:
    if request.outputType != "content_pack":
        raise ValueError("content-pack assembly requires an authorized content-pack request")
    if not children:
        raise ValueError("content pack requires at least one host-materialized child")
    return ContentArtifactDraft(
        id=f"artifact-{request.id}",
        outputPlanItemId=request.id,
        outputType="content_pack",
        title="Content pack",
        sourceSegmentRefs=list(request.evidenceRefs),
        payload=PackPayload(
            kind="content_pack",
            artifacts=[PackItem(artifactId=child.id, digest="0" * 64) for child in children],
        ),
    )


class ArtifactProductionInput(StrictModel):
    operatorBrief: str | None = Field(default=None, min_length=1, max_length=2000)
    outputPlanId: str = Field(min_length=1)
    outputPlanDigest: str = Field(pattern=r"^[0-9a-f]{64}$")
    requests: list[ArtifactRequest] = Field(min_length=1, max_length=30)
    evidence: list[ArtifactEvidence] = Field(min_length=1, max_length=500)
    brandContext: str = Field(min_length=1, max_length=4_000)
    constraints: list[str] = Field(default_factory=list, max_length=30)
    passType: Literal["original", "revision"]
    priorBatch: ProductionBatch | None
    priorReview: ArtifactReviewBatch | None

    @model_validator(mode="after")
    def validate_authority(self):
        evidence = {item.id for item in self.evidence}
        if any(ref not in evidence for request in self.requests for ref in request.evidenceRefs):
            raise ValueError("artifact request references evidence outside supplied evidence")
        if len({item.id for item in self.requests}) != len(self.requests):
            raise ValueError("artifact request ids must be unique")
        if self.passType == "original" and (self.priorBatch is not None or self.priorReview is not None):
            raise ValueError("original production cannot contain revision context")
        if self.passType == "revision" and (self.priorBatch is None or self.priorReview is None):
            raise ValueError("revision production requires prior batch and review")
        return self


class ArtifactReviewInput(StrictModel):
    productionInput: ArtifactProductionInput
    batch: ProductionBatch
