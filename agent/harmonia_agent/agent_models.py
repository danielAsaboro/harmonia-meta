"""Typed contracts shared by Harmonia's ADK specialists and stage handlers."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Annotated, Any, Callable, Literal
from urllib.parse import urlparse
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, StrictBool, StrictInt, StrictStr, field_validator, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


Identifier = Annotated[str, Field(min_length=1, max_length=100)]
ConstraintText = Annotated[str, Field(min_length=1, max_length=300)]
AssumptionText = Annotated[str, Field(min_length=1, max_length=500)]
StrictIdentifier = Annotated[StrictStr, Field(min_length=1, max_length=100)]
StrictConstraintText = Annotated[StrictStr, Field(min_length=1, max_length=300)]
StrictAssumptionText = Annotated[StrictStr, Field(min_length=1, max_length=500)]
StrictDigest = Annotated[StrictStr, Field(pattern=r"^[0-9a-f]{64}$")]


class TimeRangeLocator(StrictModel):
    kind: Literal["time_range"] = "time_range"
    startMs: int = Field(ge=0)
    endMs: int = Field(ge=0)

    @model_validator(mode="after")
    def validate_range(self) -> "TimeRangeLocator":
        if self.endMs < self.startMs:
            raise ValueError("range end must not precede start")
        return self


class FrameLocator(StrictModel):
    kind: Literal["frame"] = "frame"
    timestampMs: int = Field(ge=0)
    frameArtifactId: str = Field(min_length=1)


class PageRangeLocator(StrictModel):
    kind: Literal["page_range"] = "page_range"
    startPage: int = Field(ge=1)
    endPage: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_range(self) -> "PageRangeLocator":
        if self.endPage < self.startPage:
            raise ValueError("range end must not precede start")
        return self


class ParagraphRangeLocator(StrictModel):
    kind: Literal["paragraph_range"] = "paragraph_range"
    startParagraph: int = Field(ge=1)
    endParagraph: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_range(self) -> "ParagraphRangeLocator":
        if self.endParagraph < self.startParagraph:
            raise ValueError("range end must not precede start")
        return self


class LineRangeLocator(StrictModel):
    kind: Literal["line_range"] = "line_range"
    startLine: int = Field(ge=1)
    endLine: int = Field(ge=1)

    @model_validator(mode="after")
    def validate_range(self) -> "LineRangeLocator":
        if self.endLine < self.startLine:
            raise ValueError("range end must not precede start")
        return self


class SectionLocator(StrictModel):
    kind: Literal["section"] = "section"
    heading: str = Field(min_length=1)
    occurrence: int = Field(ge=1)


class UrlFragmentLocator(StrictModel):
    kind: Literal["url_fragment"] = "url_fragment"
    canonicalUrl: str = Field(min_length=1)
    fragment: str = Field(min_length=1)

    @field_validator("canonicalUrl")
    @classmethod
    def validate_url(cls, value: str) -> str:
        if urlparse(value).scheme not in {"http", "https"}:
            raise ValueError("canonical URL must use http or https")
        return value


EvidenceLocator = Annotated[
    TimeRangeLocator | FrameLocator | PageRangeLocator | ParagraphRangeLocator | LineRangeLocator | SectionLocator | UrlFragmentLocator,
    Field(discriminator="kind"),
]


class ContentSegment(StrictModel):
    id: str = Field(min_length=1)
    text: str = Field(min_length=1)
    locator: EvidenceLocator
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class NormalizedSource(StrictModel):
    sourceId: str = Field(min_length=1)
    sourceKind: Literal["video", "audio", "document", "web", "text"]
    title: str = Field(min_length=1)
    mimeType: str = Field(min_length=1)
    contentDigest: str = Field(pattern=r"^[0-9a-f]{64}$")
    extractorVersion: str = Field(min_length=1)
    extractedAt: datetime
    segments: list[ContentSegment] = Field(min_length=1)
    metadata: dict[str, str | int | float | bool]
    extractionReceiptId: str = Field(min_length=1)


def _require_json_list(value: object) -> object:
    if not isinstance(value, list):
        raise ValueError("JSON boundary arrays must be lists")
    return value


def _require_json_number(value: object) -> object:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError("JSON boundary numbers must be numbers, not booleans")
    return value


def _require_iso_utc_timestamp(value: object) -> object:
    if not isinstance(value, str) or not re.fullmatch(
        r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]00:00)", value,
    ):
        raise ValueError("timestamp must be an ISO-8601 UTC string")
    return value


def _require_json_string(value: object, *, maximum: int | None = None) -> None:
    if not isinstance(value, str) or (maximum is not None and len(value) > maximum):
        raise ValueError("JSON boundary strings must be bounded strings")


def _require_json_identifier(value: object) -> None:
    _require_json_string(value, maximum=100)
    if not value:
        raise ValueError("JSON boundary identifiers cannot be blank")


def _boundary_mapping(value: object, name: str) -> dict[str, Any]:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json", exclude_none=True)
    if not isinstance(value, dict):
        raise ValueError(f"{name} must be a JSON object or typed contract model")
    return value


def _required_json_field(value: dict[str, Any], field: str) -> object:
    if field not in value:
        raise ValueError(f"JSON boundary requires {field}")
    return value[field]


def _require_json_array_items(value: object, item_validator: Callable[[object], None]) -> None:
    _require_json_list(value)
    for item in value:
        item_validator(item)


def _validate_copywriter_moment(value: object) -> None:
    moment = _boundary_mapping(value, "referenced moment")
    _require_json_identifier(_required_json_field(moment, "id"))
    for field in ("title", "hook", "quote"):
        _require_json_string(_required_json_field(moment, field))
    for field in ("startSec", "endSec"):
        _require_json_number(_required_json_field(moment, field))
    if "visualHook" in moment:
        _require_json_string(moment["visualHook"], maximum=500)
    if "cropSuitability" in moment:
        _require_json_string(moment["cropSuitability"])
    if "captionSafeRegion" in moment:
        _require_json_string(moment["captionSafeRegion"], maximum=200)
    if "visualEvidenceIds" in moment:
        _require_json_array_items(moment["visualEvidenceIds"], _require_json_identifier)


def _validate_copywriter_angle(value: object) -> None:
    angle = _boundary_mapping(value, "referenced angle")
    _require_json_identifier(_required_json_field(angle, "id"))
    for field in ("angleType", "evidenceKind", "title", "rationale"):
        _require_json_string(_required_json_field(angle, field))


def _validate_copywriter_brief(value: object) -> None:
    brief = _boundary_mapping(value, "content brief")
    for field in ("id", "audienceId"):
        _require_json_identifier(_required_json_field(brief, field))
    for field in ("title", "objective", "funnelStage", "keyMessage", "ctaIntent", "intendedConversion", "kpi"):
        _require_json_string(_required_json_field(brief, field))
    _require_json_number(_required_json_field(brief, "priority"))
    if isinstance(brief["priority"], bool) or not isinstance(brief["priority"], int):
        raise ValueError("brief priority must be a JSON integer")
    for field, item_validator in (
        ("channelCandidates", _require_json_identifier),
        ("formatCandidates", _require_json_identifier),
        ("dependencies", lambda item: _require_json_string(item, maximum=300)),
        ("constraints", lambda item: _require_json_string(item, maximum=300)),
        ("evidenceRefs", _require_json_identifier),
    ):
        _require_json_array_items(_required_json_field(brief, field), item_validator)


def _validate_copywriter_item(value: object) -> None:
    item = _boundary_mapping(value, "editorial item")
    for field in ("id", "briefId", "audienceId", "channel", "format"):
        _require_json_identifier(_required_json_field(item, field))
    for field in ("campaignTheme", "contentPillar", "objective", "funnelStage", "intendedConversion", "ctaIntent", "kpi", "productionStatus", "planningRationale", "selectionRationale", "confidence"):
        _require_json_string(_required_json_field(item, field))
    for field in ("priority",):
        _require_json_number(_required_json_field(item, field))
        if isinstance(item[field], bool) or not isinstance(item[field], int):
            raise ValueError("editorial item priority must be a JSON integer")
    _require_json_number(_required_json_field(item, "selectionScore"))
    for field in ("publicationWindowStartAt", "publicationWindowEndAt", "productionDeadlineAt"):
        _require_iso_utc_timestamp(_required_json_field(item, field))
    for field, item_validator in (
        ("evidenceRefs", _require_json_identifier),
        ("dependencies", _require_json_identifier),
        ("constraints", lambda entry: _require_json_string(entry, maximum=300)),
        ("requiredAssets", lambda entry: _require_json_string(entry, maximum=300)),
    ):
        if field in item:
            _require_json_array_items(item[field], item_validator)


class Moment(StrictModel):
    id: StrictIdentifier
    title: StrictStr = Field(min_length=1, max_length=300)
    startSec: float = Field(ge=0)
    endSec: float = Field(ge=0)
    hook: StrictStr = Field(min_length=1, max_length=500)
    quote: StrictStr = Field(min_length=1, max_length=2_000)
    # A host-bound interval may overlap every segment in the bounded input.
    sourceSegmentRefs: list[StrictIdentifier] = Field(min_length=1, max_length=500)
    visualHook: StrictStr | None = Field(default=None, min_length=1, max_length=500)
    cropSuitability: Literal["poor", "fair", "good", "excellent"] | None = None
    captionSafeRegion: StrictStr | None = Field(default=None, min_length=1, max_length=200)
    visualEvidenceIds: list[StrictIdentifier] = Field(max_length=12)
    assumptions: list[StrictAssumptionText] = Field(max_length=8)
    confidence: Literal["low", "medium", "high"]

    _require_lists = field_validator(
        "sourceSegmentRefs", "visualEvidenceIds", "assumptions", mode="before",
    )(_require_json_list)

    @model_validator(mode="after")
    def validate_moment_shape(self) -> "Moment":
        if self.endSec < self.startSec:
            raise ValueError("moment end must not precede start")
        if len(self.sourceSegmentRefs) != len(set(self.sourceSegmentRefs)):
            raise ValueError("moment source references must be unique")
        if len(self.visualEvidenceIds) != len(set(self.visualEvidenceIds)):
            raise ValueError("moment visual references must be unique")
        if bool(self.visualHook) != bool(self.visualEvidenceIds):
            raise ValueError("visual hook and visual evidence ids must appear together")
        if self.confidence == "high" and self.assumptions:
            raise ValueError("high-confidence moment cannot contain assumptions")
        return self


class Angle(StrictModel):
    id: StrictIdentifier
    angleType: Literal["source_insight", "trend", "meme", "performance_learning", "memory_learning"]
    evidenceKind: Literal["source", "public_context", "performance", "memory"]
    title: StrictStr = Field(min_length=1, max_length=300)
    rationale: StrictStr = Field(min_length=1, max_length=1_000)
    # The coordinator binds source angles to the complete authoritative source
    # package (up to 500 normalized segments plus bounded moment records).
    evidenceRefs: list[StrictIdentifier] = Field(min_length=1, max_length=512)
    assumptions: list[StrictAssumptionText] = Field(max_length=8)
    confidence: Literal["low", "medium", "high"]

    _require_lists = field_validator(
        "evidenceRefs", "assumptions", mode="before",
    )(_require_json_list)

    @model_validator(mode="after")
    def validate_angle_shape(self) -> "Angle":
        if len(self.evidenceRefs) != len(set(self.evidenceRefs)):
            raise ValueError("angle evidence references must be unique")
        if self.confidence == "high" and self.assumptions:
            raise ValueError("high-confidence angle cannot contain assumptions")
        allowed = {
            "source_insight": {"source"},
            "trend": {"public_context"},
            "meme": {"public_context"},
            "performance_learning": {"performance"},
            "memory_learning": {"memory"},
        }
        if self.evidenceKind not in allowed[self.angleType]:
            raise ValueError(f"{self.angleType} angle type requires compatible evidence kind")
        return self


class SourceAnalysis(StrictModel):
    sourceDigest: StrictDigest
    summary: StrictStr = Field(min_length=1, max_length=2_000)
    moments: list[Moment] = Field(max_length=12)
    angles: list[Angle] = Field(max_length=12)
    assumptions: list[StrictAssumptionText] = Field(max_length=12)
    confidence: Literal["low", "medium", "high"]

    _require_lists = field_validator(
        "moments", "angles", "assumptions", mode="before",
    )(_require_json_list)

    @model_validator(mode="after")
    def validate_analysis_shape(self) -> "SourceAnalysis":
        moment_ids = [moment.id for moment in self.moments]
        angle_ids = [angle.id for angle in self.angles]
        if len(moment_ids) != len(set(moment_ids)):
            raise ValueError("moment ids must be unique")
        if len(angle_ids) != len(set(angle_ids)):
            raise ValueError("angle ids must be unique")
        if set(moment_ids).intersection(angle_ids):
            raise ValueError("moment and angle ids must be globally unique")
        if not self.moments and not self.angles:
            raise ValueError("analysis requires at least one grounded moment or angle")
        if self.confidence == "high" and self.assumptions:
            raise ValueError("high-confidence analysis cannot contain assumptions")
        return self


class AnalystEvidenceSegment(StrictModel):
    id: StrictIdentifier
    sourceId: StrictIdentifier
    text: StrictStr = Field(min_length=1, max_length=10_000)
    locator: EvidenceLocator
    digest: StrictDigest


class AnalystPerformanceObservation(StrictModel):
    id: StrictIdentifier
    summary: StrictStr = Field(min_length=1, max_length=1_000)
    firestoreEvidenceRef: StrictStr = Field(min_length=1, max_length=500)


class AnalystMemoryFact(StrictModel):
    id: StrictIdentifier
    kind: Literal["operator_decision", "verified_outcome", "learning", "preference"]
    content: StrictStr = Field(min_length=1, max_length=1_000)
    firestoreEvidenceRef: StrictStr = Field(min_length=1, max_length=500)


class AnalystResearchRequest(StrictModel):
    id: StrictStr = Field(pattern=r"^analysis-research-[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$")
    question: StrictStr = Field(min_length=10, max_length=500)
    justification: StrictStr = Field(min_length=10, max_length=500)


class AnalystInput(StrictModel):
    sourceIds: list[StrictIdentifier] = Field(min_length=1, max_length=10_000)
    sourceKind: Literal["video", "audio", "document", "web", "text", "mixed"]
    sourceDigest: StrictDigest
    title: StrictStr = Field(min_length=1, max_length=300)
    operatorInstructions: list[StrictConstraintText] = Field(default_factory=list, max_length=12)
    sourceSegments: list[AnalystEvidenceSegment] = Field(min_length=1, max_length=500)
    performanceObservations: list[AnalystPerformanceObservation] = Field(max_length=5)
    memoryFacts: list[AnalystMemoryFact] = Field(max_length=5)
    researchRequest: AnalystResearchRequest | None = None

    _require_lists = field_validator(
        "sourceIds", "sourceSegments", "operatorInstructions", "performanceObservations", "memoryFacts", mode="before",
    )(_require_json_list)

    @model_validator(mode="after")
    def validate_source_package(self) -> "AnalystInput":
        segment_ids = [segment.id for segment in self.sourceSegments]
        if len(segment_ids) != len(set(segment_ids)):
            raise ValueError("segment ids must be unique")
        if set(segment.sourceId for segment in self.sourceSegments) - set(self.sourceIds):
            raise ValueError("source segment references a source outside the manifest")
        for items, label in (
            (self.performanceObservations, "performance observation"),
            (self.memoryFacts, "memory fact"),
        ):
            ids = [item.id for item in items]
            if len(ids) != len(set(ids)):
                raise ValueError(f"{label} ids must be unique")
        return self


class AudienceSegment(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    name: str = Field(min_length=1, max_length=200)
    pains: list[str] = Field(min_length=1, max_length=8)


class CompanyContext(StrictModel):
    evidenceId: str = Field(min_length=1, max_length=100)
    company: str = Field(min_length=1, max_length=200)
    product: str = Field(min_length=1, max_length=500)
    positioning: str = Field(min_length=1, max_length=500)
    differentiators: list[str] = Field(min_length=1, max_length=8)
    brandVoice: list[str] = Field(min_length=1, max_length=8)
    exclusions: list[str] = Field(default_factory=list, max_length=12)
    safetyConstraints: list[str] = Field(default_factory=list, max_length=12)


class CampaignContext(StrictModel):
    operatorBrief: str | None = Field(default=None, min_length=1, max_length=2000)
    evidenceId: str = Field(min_length=1, max_length=100)
    businessObjectives: list[str] = Field(min_length=1, max_length=8)
    campaignObjectives: list[str] = Field(min_length=1, max_length=8)
    audiences: list[AudienceSegment] = Field(min_length=1, max_length=6)
    funnelStage: Literal["awareness", "consideration", "conversion", "retention", "advocacy"]
    intendedConversion: str = Field(min_length=1, max_length=300)
    requestedChannels: list[str] = Field(min_length=1, max_length=8)
    supportedChannels: list[str] = Field(min_length=1, max_length=8)
    horizonWeeks: int = Field(default=4, ge=1, le=12)


class PerformanceObservation(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    summary: str = Field(min_length=1, max_length=600)
    firestoreEvidenceRef: str = Field(min_length=1, max_length=500)


class MemoryFact(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    content: str = Field(min_length=1, max_length=600)
    firestoreEvidenceRef: str = Field(min_length=1, max_length=500)


class StrategyResearchRequest(StrictModel):
    id: str = Field(pattern=r"^research-[A-Za-z0-9][A-Za-z0-9._:-]{0,90}$")
    question: str = Field(min_length=10, max_length=500)
    justification: str = Field(min_length=10, max_length=500)


class StrategistInput(StrictModel):
    source_title: str = Field(min_length=1, max_length=300)
    company: CompanyContext
    campaign: CampaignContext
    analysis: SourceAnalysis
    performance: list[PerformanceObservation] = Field(default_factory=list, max_length=12)
    memoryFacts: list[MemoryFact] = Field(default_factory=list, max_length=5)
    researchRequest: StrategyResearchRequest | None = None
    revision: int = Field(default=1, ge=1, le=2)
    revisionFeedback: str | None = Field(default=None, max_length=2_000)

    @model_validator(mode="after")
    def validate_revision(self) -> "StrategistInput":
        if self.revision == 2 and not (self.revisionFeedback or "").strip():
            raise ValueError("strategy revision feedback is required")
        return self


class EvidenceClaim(StrictModel):
    text: str = Field(min_length=1, max_length=600)
    evidenceRefs: list[str] = Field(min_length=1, max_length=12)


class AudiencePriority(StrictModel):
    audienceId: str = Field(min_length=1, max_length=100)
    priority: int = Field(ge=1, le=5)
    reason: str = Field(min_length=1, max_length=500)
    evidenceRefs: list[str] = Field(min_length=1, max_length=12)


class StrategicPillar(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    purpose: str = Field(min_length=1, max_length=500)
    evidenceRefs: list[str] = Field(min_length=1, max_length=12)


class CampaignTheme(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=500)
    evidenceRefs: list[str] = Field(min_length=1, max_length=12)


class ChannelRole(StrictModel):
    channel: str = Field(min_length=1, max_length=100)
    role: str = Field(min_length=1, max_length=300)
    operationallySupported: bool
    formats: list[str] = Field(min_length=1, max_length=8)
    cadence: str = Field(min_length=1, max_length=200)
    evidenceRefs: list[str] = Field(min_length=1, max_length=12)


class ContentMixItem(StrictModel):
    format: str = Field(min_length=1, max_length=100)
    percentage: int = Field(ge=1, le=100)


class StrategyKpi(StrictModel):
    name: str = Field(min_length=1, max_length=200)
    target: str = Field(min_length=1, max_length=200)
    measurement: str = Field(min_length=1, max_length=300)
    evidenceRefs: list[str] = Field(min_length=1, max_length=12)


class StrategyAssumption(StrictModel):
    text: str = Field(min_length=1, max_length=500)
    evidenceRefs: list[str] = Field(min_length=1, max_length=12)
    confidence: Literal["low", "medium", "high"]


class ContentBrief(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=300)
    objective: str = Field(min_length=1, max_length=600)
    audienceId: str = Field(min_length=1, max_length=100)
    funnelStage: Literal["awareness", "consideration", "conversion", "retention", "advocacy"]
    keyMessage: str = Field(min_length=1, max_length=600)
    channelCandidates: list[str] = Field(min_length=1, max_length=8)
    formatCandidates: list[str] = Field(min_length=1, max_length=8)
    ctaIntent: str = Field(min_length=1, max_length=300)
    intendedConversion: str = Field(min_length=1, max_length=300)
    kpi: str = Field(min_length=1, max_length=200)
    priority: int = Field(ge=1, le=5)
    dependencies: list[ConstraintText] = Field(default_factory=list, max_length=8)
    constraints: list[ConstraintText] = Field(default_factory=list, max_length=12)
    evidenceRefs: list[str] = Field(min_length=1, max_length=12)


class ContentStrategy(StrictModel):
    strategyId: str = Field(min_length=1, max_length=100)
    version: int = Field(ge=1, le=2)
    horizonWeeks: int = Field(ge=1, le=12)
    thesis: str = Field(min_length=1, max_length=600)
    differentiatedNarrative: str = Field(min_length=1, max_length=600)
    objectives: list[EvidenceClaim] = Field(min_length=1, max_length=8)
    audiencePriorities: list[AudiencePriority] = Field(min_length=1, max_length=6)
    funnelIntent: Literal["awareness", "consideration", "conversion", "retention", "advocacy"]
    intendedConversions: list[str] = Field(min_length=1, max_length=6)
    pillars: list[StrategicPillar] = Field(min_length=1, max_length=8)
    campaignThemes: list[CampaignTheme] = Field(min_length=1, max_length=8)
    channelRoles: list[ChannelRole] = Field(min_length=1, max_length=8)
    contentMix: list[ContentMixItem] = Field(min_length=1, max_length=8)
    cadenceGuidance: str = Field(min_length=1, max_length=300)
    priorityRules: list[str] = Field(min_length=1, max_length=8)
    ctaGuidance: list[str] = Field(min_length=1, max_length=8)
    kpis: list[StrategyKpi] = Field(min_length=1, max_length=8)
    successCriteria: list[str] = Field(min_length=1, max_length=8)
    constraints: list[str] = Field(default_factory=list, max_length=12)
    exclusions: list[str] = Field(default_factory=list, max_length=12)
    brandSafety: list[str] = Field(default_factory=list, max_length=12)
    briefs: list[ContentBrief] = Field(min_length=1, max_length=10)
    assumptions: list[StrategyAssumption] = Field(default_factory=list, max_length=8)
    confidence: Literal["low", "medium", "high"]

    @model_validator(mode="after")
    def validate_mix(self) -> "ContentStrategy":
        if sum(item.percentage for item in self.contentMix) != 100:
            raise ValueError("content mix percentages must total 100")
        return self


class StrategistResult(StrictModel):
    strategy: ContentStrategy


def _validate_utc_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() != timezone.utc.utcoffset(value):
        raise ValueError("timestamp must be UTC")
    return value


def _validate_iana_timezone(value: str) -> str:
    try:
        ZoneInfo(value)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("timezone must be a valid IANA timezone") from exc
    return value


class StrategyApprovalRecord(StrictModel):
    decision: Literal["approved"]
    payloadDigest: str = Field(pattern=r"^[0-9a-f]{64}$")
    revision: int = Field(ge=1, le=2)
    actorSubjectId: str = Field(min_length=1, max_length=200)
    decidedAt: datetime
    expiresAt: datetime
    feedback: str | None = Field(default=None, max_length=2_000)

    @field_validator("decidedAt", "expiresAt")
    @classmethod
    def validate_utc_timestamp(cls, value: datetime) -> datetime:
        return _validate_utc_timestamp(value)


class ChannelCapability(StrictModel):
    channel: str = Field(min_length=1, max_length=100)
    formats: list[Identifier] = Field(min_length=1, max_length=8)


class EditorialCommitment(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    channel: str = Field(min_length=1, max_length=100)
    publicationWindowStartAt: datetime
    publicationWindowEndAt: datetime

    @field_validator("publicationWindowStartAt", "publicationWindowEndAt")
    @classmethod
    def validate_utc_timestamp(cls, value: datetime) -> datetime:
        return _validate_utc_timestamp(value)

    @model_validator(mode="after")
    def validate_window(self) -> "EditorialCommitment":
        if self.publicationWindowStartAt >= self.publicationWindowEndAt:
            raise ValueError("publication window must increase")
        return self


class ProductionCapacity(StrictModel):
    maxItems: int = Field(ge=1, le=48)
    maxItemsPerWeek: int = Field(ge=1, le=12)


class CadenceConstraints(StrictModel):
    minimumHoursBetweenItems: int = Field(ge=0, le=168)
    maxItemsPerChannelPerWeek: int = Field(ge=1, le=12)


class PostingWindowObservation(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    channel: str = Field(min_length=1, max_length=100)
    format: str = Field(min_length=1, max_length=100)
    observedAt: datetime
    evidenceRefs: list[Identifier] = Field(min_length=1, max_length=12)

    @field_validator("observedAt")
    @classmethod
    def validate_utc_timestamp(cls, value: datetime) -> datetime:
        return _validate_utc_timestamp(value)


class AssetReadiness(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    briefId: str = Field(min_length=1, max_length=100)
    assetType: str = Field(min_length=1, max_length=100)
    status: Literal["ready", "missing", "blocked"]
    evidenceRefs: list[Identifier] = Field(min_length=1, max_length=12)


class BlockedDependency(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    briefId: str = Field(min_length=1, max_length=100)
    reason: str = Field(min_length=1, max_length=300)
    evidenceRefs: list[Identifier] = Field(min_length=1, max_length=12)


class CalendarProjection(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    contentItemId: str = Field(min_length=1, max_length=100)
    state: Literal["not_projected", "synced", "update_required", "removed", "failed"]
    externalEventId: str | None = Field(default=None, min_length=1, max_length=300)
    evidenceRefs: list[Identifier] = Field(min_length=1, max_length=12)


class EditorialPlanningSnapshot(StrictModel):
    snapshotId: str = Field(min_length=1, max_length=100)
    asOf: datetime
    horizonStartAt: datetime
    horizonEndAt: datetime
    timezone: str = Field(min_length=1, max_length=100)
    channelCapabilities: list[ChannelCapability] = Field(min_length=1, max_length=8)
    existingCommitments: list[EditorialCommitment] = Field(default_factory=list, max_length=48)
    productionCapacity: ProductionCapacity
    cadenceConstraints: CadenceConstraints
    postingWindowObservations: list[PostingWindowObservation] = Field(default_factory=list, max_length=24)
    assetReadiness: list[AssetReadiness] = Field(default_factory=list, max_length=48)
    blockedDependencies: list[BlockedDependency] = Field(default_factory=list, max_length=48)
    calendarProjection: list[CalendarProjection] = Field(default_factory=list, max_length=48)
    provenanceIds: list[Identifier] = Field(min_length=1, max_length=100)

    @field_validator("asOf", "horizonStartAt", "horizonEndAt")
    @classmethod
    def validate_utc_timestamp(cls, value: datetime) -> datetime:
        return _validate_utc_timestamp(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return _validate_iana_timezone(value)

    @model_validator(mode="after")
    def validate_horizon(self) -> "EditorialPlanningSnapshot":
        if self.horizonStartAt >= self.horizonEndAt:
            raise ValueError("editorial horizon must increase")
        return self


class EditorialPlannerInput(StrictModel):
    strategy: ContentStrategy
    strategyDigest: str = Field(pattern=r"^[0-9a-f]{64}$")
    strategyVersion: int = Field(ge=1, le=2)
    strategyApproval: StrategyApprovalRecord
    analysis: SourceAnalysis
    planningSnapshot: EditorialPlanningSnapshot
    planningSnapshotDigest: str = Field(pattern=r"^[0-9a-f]{64}$")
    revision: int = Field(ge=1, le=2)
    replanningFeedback: str | None = Field(default=None, max_length=2_000)

    @property
    def horizonStartAt(self) -> datetime: return self.planningSnapshot.horizonStartAt
    @property
    def horizonEndAt(self) -> datetime: return self.planningSnapshot.horizonEndAt
    @property
    def timezone(self) -> str: return self.planningSnapshot.timezone
    @property
    def channelCapabilities(self) -> list[ChannelCapability]: return self.planningSnapshot.channelCapabilities
    @property
    def existingCommitments(self) -> list[EditorialCommitment]: return self.planningSnapshot.existingCommitments
    @property
    def productionCapacity(self) -> ProductionCapacity: return self.planningSnapshot.productionCapacity
    @property
    def cadenceConstraints(self) -> CadenceConstraints: return self.planningSnapshot.cadenceConstraints
    @property
    def postingWindowObservations(self) -> list[PostingWindowObservation]: return self.planningSnapshot.postingWindowObservations


class EditorialPlanItem(StrictModel):
    id: str = Field(min_length=1, max_length=100)
    briefId: str = Field(min_length=1, max_length=100)
    campaignTheme: str = Field(min_length=1, max_length=200)
    contentPillar: str = Field(min_length=1, max_length=200)
    objective: str = Field(min_length=1, max_length=600)
    audienceId: str = Field(min_length=1, max_length=100)
    funnelStage: Literal["awareness", "consideration", "conversion", "retention", "advocacy"]
    intendedConversion: str = Field(min_length=1, max_length=300)
    ctaIntent: str = Field(min_length=1, max_length=300)
    kpi: str = Field(min_length=1, max_length=200)
    channel: str = Field(min_length=1, max_length=100)
    format: str = Field(min_length=1, max_length=100)
    evidenceRefs: list[Identifier] = Field(min_length=1, max_length=12)
    publicationWindowStartAt: datetime
    publicationWindowEndAt: datetime
    productionDeadlineAt: datetime
    priority: int = Field(ge=1, le=5)
    selectionScore: float = Field(ge=0, le=1)
    dependencies: list[Identifier] = Field(default_factory=list, max_length=8)
    productionStatus: Literal["planned"]
    constraints: list[ConstraintText] = Field(default_factory=list, max_length=12)
    requiredAssets: list[ConstraintText] = Field(default_factory=list, max_length=12)
    planningRationale: str = Field(min_length=1, max_length=600)
    selectionRationale: str = Field(min_length=1, max_length=600)
    confidence: Literal["low", "medium", "high"]

    @field_validator("publicationWindowStartAt", "publicationWindowEndAt", "productionDeadlineAt")
    @classmethod
    def validate_utc_timestamp(cls, value: datetime) -> datetime:
        return _validate_utc_timestamp(value)

    @model_validator(mode="after")
    def validate_timing(self) -> "EditorialPlanItem":
        if self.publicationWindowStartAt >= self.publicationWindowEndAt:
            raise ValueError("publication window must increase")
        if self.productionDeadlineAt > self.publicationWindowStartAt:
            raise ValueError("production deadline must be before the publication window")
        return self


class EditorialPlan(StrictModel):
    planId: str = Field(min_length=1, max_length=100)
    version: int = Field(ge=1, le=2)
    approvedStrategyDigest: str = Field(pattern=r"^[0-9a-f]{64}$")
    planningSnapshotId: str = Field(min_length=1, max_length=100)
    planningSnapshotDigest: str = Field(pattern=r"^[0-9a-f]{64}$")
    horizonStartAt: datetime
    horizonEndAt: datetime
    timezone: str = Field(min_length=1, max_length=100)
    summary: str = Field(min_length=1, max_length=1_000)
    sequencingRationale: str = Field(min_length=1, max_length=1_000)
    cadenceRationale: str = Field(min_length=1, max_length=1_000)
    assumptions: list[AssumptionText] = Field(default_factory=list, max_length=12)
    confidence: Literal["low", "medium", "high"]
    items: list[EditorialPlanItem] = Field(min_length=1, max_length=48)
    selectedNextItemId: str = Field(min_length=1, max_length=100)

    @field_validator("horizonStartAt", "horizonEndAt")
    @classmethod
    def validate_utc_timestamp(cls, value: datetime) -> datetime:
        return _validate_utc_timestamp(value)

    @field_validator("timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        return _validate_iana_timezone(value)

    @model_validator(mode="after")
    def validate_horizon_and_selection(self) -> "EditorialPlan":
        if self.horizonStartAt >= self.horizonEndAt:
            raise ValueError("editorial horizon must increase")
        selected = [item for item in self.items if item.id == self.selectedNextItemId]
        if len(selected) != 1:
            raise ValueError("selectedNextItemId must identify exactly one plan item")
        return self


class ContentClaim(StrictModel):
    text: StrictStr = Field(min_length=1, max_length=600)
    evidenceRefs: list[StrictIdentifier] = Field(min_length=1, max_length=12)

    _require_evidence_refs_list = field_validator("evidenceRefs", mode="before")(_require_json_list)


class ContentDraft(StrictModel):
    id: StrictIdentifier
    planId: StrictIdentifier
    planDigest: StrictDigest
    strategyDigest: StrictDigest
    editorialItemId: StrictIdentifier
    briefId: StrictIdentifier
    revision: StrictInt = Field(ge=1, le=2)
    platform: Literal["x"]
    format: Literal["text_post"]
    audienceId: StrictIdentifier
    objective: StrictStr = Field(min_length=1, max_length=300)
    funnelStage: Literal["awareness", "consideration", "conversion", "retention", "advocacy"]
    ctaIntent: StrictStr = Field(min_length=1, max_length=300)
    text: StrictStr = Field(min_length=1, max_length=280)
    ctaTreatment: StrictStr = Field(min_length=1, max_length=300)
    intendedConversion: StrictStr = Field(min_length=1, max_length=300)
    evidenceRefs: list[StrictIdentifier] = Field(min_length=1, max_length=12)
    claims: list[ContentClaim] = Field(..., max_length=12)
    assumptions: list[StrictAssumptionText] = Field(..., max_length=8)
    confidence: Literal["low", "medium", "high"]
    appliedConstraints: list[StrictConstraintText] = Field(min_length=1, max_length=24)
    priorDraftId: StrictIdentifier | None = Field(...)
    addressedIssueIds: list[StrictIdentifier] = Field(..., max_length=12)

    _require_lists = field_validator(
        "evidenceRefs", "claims", "assumptions", "appliedConstraints", "addressedIssueIds", mode="before",
    )(_require_json_list)

    @model_validator(mode="after")
    def validate_revision_linkage(self) -> "ContentDraft":
        if self.revision == 1:
            if self.priorDraftId is not None or self.addressedIssueIds:
                raise ValueError("original draft cannot contain revision linkage")
        elif self.priorDraftId is None or not self.addressedIssueIds:
            raise ValueError("revision draft requires prior draft linkage and addressed issue ids")
        elif self.id == self.priorDraftId:
            raise ValueError("revision draft id must be distinct from its prior draft and cannot self-link")
        if len(self.evidenceRefs) != len(set(self.evidenceRefs)):
            raise ValueError("draft evidence references must be unique")
        if len(self.addressedIssueIds) != len(set(self.addressedIssueIds)):
            raise ValueError("addressed issue ids must be unique")
        return self


class EditorialReviewIssue(StrictModel):
    id: StrictIdentifier
    category: Literal["grounding", "brief_alignment", "brand_voice", "platform_constraints", "cta", "safety", "clarity"]
    severity: Literal["low", "medium", "high"]
    fieldPath: Literal[
        "text", "ctaTreatment", "claims", "assumptions", "evidenceRefs",
        "appliedConstraints", "audienceId", "objective", "funnelStage",
        "intendedConversion", "platform", "format",
    ]
    instruction: StrictStr = Field(min_length=1, max_length=1_000)
    evidenceRefs: list[StrictIdentifier] = Field(..., max_length=12)
    constraintRefs: list[StrictConstraintText] = Field(..., max_length=24)

    _require_reference_lists = field_validator("evidenceRefs", "constraintRefs", mode="before")(_require_json_list)


EditorialDimension = Literal[
    "grounding", "brief_alignment", "brand_voice", "platform_constraints",
    "cta", "safety", "clarity",
]
_EDITORIAL_DIMENSIONS = (
    "grounding", "brief_alignment", "brand_voice", "platform_constraints",
    "cta", "safety", "clarity",
)


class EditorialCheck(StrictModel):
    dimension: EditorialDimension
    status: Literal["pass", "fail"]
    rationale: StrictStr = Field(min_length=1, max_length=1_000)
    evidenceRefs: list[StrictIdentifier] = Field(..., max_length=12)
    constraintRefs: list[StrictConstraintText] = Field(..., max_length=24)

    _require_reference_lists = field_validator(
        "evidenceRefs", "constraintRefs", mode="before",
    )(_require_json_list)


class EditorialAssessment(StrictModel):
    verdict: Literal["accepted", "revise"]
    checks: list[EditorialCheck] = Field(min_length=7, max_length=7)
    issues: list[EditorialReviewIssue] = Field(..., max_length=12)
    resolvedIssueIds: list[StrictIdentifier] = Field(..., max_length=12)

    _require_lists = field_validator(
        "checks", "issues", "resolvedIssueIds", mode="before",
    )(_require_json_list)

    @model_validator(mode="after")
    def validate_complete_consistent_judgment(self) -> "EditorialAssessment":
        dimensions = [check.dimension for check in self.checks]
        if set(dimensions) != set(_EDITORIAL_DIMENSIONS) or len(dimensions) != len(set(dimensions)):
            raise ValueError("assessment must contain every editorial dimension exactly once")
        failed = {check.dimension for check in self.checks if check.status == "fail"}
        issue_categories = {issue.category for issue in self.issues}
        if self.verdict == "accepted" and (failed or self.issues):
            raise ValueError("accepted assessment requires all checks to pass and no issues")
        if self.verdict == "revise" and (not failed or not self.issues):
            raise ValueError("revise assessment requires failed checks and issues")
        if self.verdict == "revise" and issue_categories != failed:
            raise ValueError("failed assessment dimensions must match issue categories")
        issue_ids = [issue.id for issue in self.issues]
        if len(issue_ids) != len(set(issue_ids)):
            raise ValueError("assessment issue ids must be unique")
        if len(self.resolvedIssueIds) != len(set(self.resolvedIssueIds)):
            raise ValueError("resolved issue ids must be unique")
        return self


class EditorialReview(StrictModel):
    id: StrictIdentifier
    planId: StrictIdentifier
    planDigest: StrictDigest
    strategyDigest: StrictDigest
    editorialItemId: StrictIdentifier
    briefId: StrictIdentifier
    draftId: StrictIdentifier
    revision: StrictInt = Field(ge=1, le=2)
    verdict: Literal["accepted", "revise"]
    reviewedAt: datetime
    checks: list[EditorialCheck] = Field(min_length=7, max_length=7)
    issues: list[EditorialReviewIssue] = Field(..., max_length=12)
    resolvedIssueIds: list[StrictIdentifier] = Field(..., max_length=12)

    @field_validator("reviewedAt", mode="before")
    @classmethod
    def require_serialized_timestamp(cls, value: object) -> object:
        return _require_iso_utc_timestamp(value)

    @field_validator("reviewedAt")
    @classmethod
    def validate_utc_timestamp(cls, value: datetime) -> datetime:
        return _validate_utc_timestamp(value)

    @model_validator(mode="after")
    def validate_verdict_and_issues(self) -> "EditorialReview":
        EditorialAssessment(
            verdict=self.verdict, checks=self.checks, issues=self.issues,
            resolvedIssueIds=self.resolvedIssueIds,
        )
        return self

    _require_lists = field_validator(
        "checks", "issues", "resolvedIssueIds", mode="before",
    )(_require_json_list)


class CopywriterInput(StrictModel):
    planId: StrictIdentifier
    planDigest: StrictDigest
    strategyDigest: StrictDigest
    editorialItemId: StrictIdentifier
    briefId: StrictIdentifier
    editorialItem: EditorialPlanItem
    brief: ContentBrief
    referencedMoments: list[Moment] = Field(..., max_length=12)
    referencedAngles: list[Angle] = Field(..., max_length=12)
    brandContext: StrictStr = Field(min_length=1, max_length=4_000)
    constraints: list[StrictConstraintText] = Field(..., max_length=24)
    platform: Literal["x"]
    format: Literal["text_post"]
    passType: Literal["original", "revision"]
    priorDraft: ContentDraft | None = Field(...)
    priorReview: EditorialReview | None = Field(...)

    _require_lists = field_validator("referencedMoments", "referencedAngles", "constraints", mode="before")(_require_json_list)

    @model_validator(mode="before")
    @classmethod
    def validate_json_handoff_boundary(cls, value: object) -> object:
        if isinstance(value, BaseModel) or not isinstance(value, dict):
            return value
        _validate_copywriter_item(_required_json_field(value, "editorialItem"))
        _validate_copywriter_brief(_required_json_field(value, "brief"))
        _require_json_array_items(_required_json_field(value, "referencedMoments"), _validate_copywriter_moment)
        _require_json_array_items(_required_json_field(value, "referencedAngles"), _validate_copywriter_angle)
        _require_json_array_items(_required_json_field(value, "constraints"), lambda entry: _require_json_string(entry, maximum=300))
        return value

    @model_validator(mode="after")
    def validate_selected_authority_and_revision(self) -> "CopywriterInput":
        if self.brief.id != self.editorialItem.briefId:
            raise ValueError("copywriter input must contain the exact selected brief")
        if self.editorialItemId != self.editorialItem.id or self.briefId != self.brief.id:
            raise ValueError("copywriter input ids must match the exact selected item and brief")
        exact_fields = ("objective", "audienceId", "funnelStage", "intendedConversion", "ctaIntent", "kpi")
        if any(getattr(self.brief, field) != getattr(self.editorialItem, field) for field in exact_fields):
            raise ValueError("copywriter input brief does not match the selected editorial item")
        if set(self.brief.evidenceRefs) != set(self.editorialItem.evidenceRefs):
            raise ValueError("copywriter input brief evidence does not match the selected editorial item")
        supplied_ids = [item.id for item in [*self.referencedMoments, *self.referencedAngles]]
        if (
            not supplied_ids
            or not set(supplied_ids).issubset(set(self.editorialItem.evidenceRefs))
            or len(supplied_ids) != len(set(supplied_ids))
        ):
            raise ValueError("copywriter input must contain only referenced Nimi evidence")
        if self.editorialItem.channel != self.platform or self.editorialItem.format != self.format:
            raise ValueError("copywriter platform and format must match the selected item")
        if self.platform not in self.brief.channelCandidates or self.format not in self.brief.formatCandidates:
            raise ValueError("copywriter platform and format must be supported by the selected brief")
        if self.passType == "original":
            if self.priorDraft is not None or self.priorReview is not None:
                raise ValueError("original pass cannot contain revision context")
        else:
            if self.priorDraft is None:
                raise ValueError("revision pass requires a prior draft")
            if self.priorReview is None:
                raise ValueError("revision pass requires a prior review")
            if self.priorReview.verdict != "revise":
                raise ValueError("revision pass requires a revise review")
            if self.priorDraft.revision != 1 or self.priorReview.revision != 1:
                raise ValueError("revision pass must target the original revision-1 draft and review")
            if self.priorReview.draftId != self.priorDraft.id or self.priorReview.revision != self.priorDraft.revision:
                raise ValueError("revision context must review the exact prior draft")
            lineage = (self.planId, self.planDigest, self.strategyDigest, self.editorialItemId, self.briefId)
            prior_lineage = (self.priorDraft.planId, self.priorDraft.planDigest, self.priorDraft.strategyDigest, self.priorDraft.editorialItemId, self.priorDraft.briefId)
            review_lineage = (self.priorReview.planId, self.priorReview.planDigest, self.priorReview.strategyDigest, self.priorReview.editorialItemId, self.priorReview.briefId)
            if lineage != prior_lineage or lineage != review_lineage:
                raise ValueError("revision context must preserve exact lineage")
        return self


class DraftWorkflowResult(StrictModel):
    originalDraft: ContentDraft
    reviews: list[EditorialReview] = Field(min_length=1, max_length=2)
    revisionDraft: ContentDraft | None = Field(...)
    acceptedDraft: ContentDraft

    _require_reviews_list = field_validator("reviews", mode="before")(_require_json_list)

    @model_validator(mode="after")
    def validate_bounded_trace(self) -> "DraftWorkflowResult":
        original = self.originalDraft
        if original.revision != 1:
            raise ValueError("workflow original draft must be revision 1")
        if len({review.id for review in self.reviews}) != len(self.reviews):
            raise ValueError("workflow review ids must be unique")
        first = self.reviews[0]
        if first.draftId != original.id or first.revision != 1:
            raise ValueError("first review must bind the exact original draft")
        lineage = (
            original.planId, original.planDigest, original.strategyDigest,
            original.editorialItemId, original.briefId,
        )
        for review in self.reviews:
            if (
                review.planId, review.planDigest, review.strategyDigest,
                review.editorialItemId, review.briefId,
            ) != lineage:
                raise ValueError("workflow reviews must preserve exact lineage")
        if first.verdict == "accepted":
            if len(self.reviews) != 1 or self.revisionDraft is not None:
                raise ValueError("accepted original cannot contain a revision trace")
            if self.acceptedDraft != original:
                raise ValueError("accepted draft must equal the accepted original")
            return self
        revision = self.revisionDraft
        if revision is None or len(self.reviews) != 2:
            raise ValueError("revise verdict requires one complete revision trace")
        final = self.reviews[1]
        if revision.revision != 2 or revision.priorDraftId != original.id:
            raise ValueError("workflow revision must link the exact original draft")
        if (
            revision.planId, revision.planDigest, revision.strategyDigest,
            revision.editorialItemId, revision.briefId,
        ) != lineage:
            raise ValueError("workflow revision must preserve exact lineage")
        if final.draftId != revision.id or final.revision != 2:
            raise ValueError("final review must bind the exact revision draft")
        if final.verdict != "accepted":
            raise ValueError("bounded workflow final review must be accepted")
        if self.acceptedDraft != revision:
            raise ValueError("accepted draft must equal the accepted revision")
        return self


class EditorialReviewInput(StrictModel):
    copywriterInput: CopywriterInput
    draft: ContentDraft

    @model_validator(mode="after")
    def validate_exact_draft_authority(self) -> "EditorialReviewInput":
        lineage = (
            self.copywriterInput.planId,
            self.copywriterInput.planDigest,
            self.copywriterInput.strategyDigest,
            self.copywriterInput.editorialItemId,
            self.copywriterInput.briefId,
        )
        draft_lineage = (
            self.draft.planId,
            self.draft.planDigest,
            self.draft.strategyDigest,
            self.draft.editorialItemId,
            self.draft.briefId,
        )
        if lineage != draft_lineage:
            raise ValueError("Dara input must preserve exact production lineage")
        expected_revision = 1 if self.copywriterInput.passType == "original" else 2
        if self.draft.revision != expected_revision:
            raise ValueError("Dara input draft revision does not match the copywriter pass")
        return self


class LiaisonInput(StrictModel):
    """Operator question routed to the skill-enabled insight liaison."""

    question: StrictStr = Field(min_length=1, max_length=2000)


class LiaisonClaim(StrictModel):
    text: StrictStr = Field(min_length=1, max_length=1_000)
    evidenceIds: list[StrictIdentifier] = Field(min_length=1, max_length=8)

    _require_evidence = field_validator("evidenceIds", mode="before")(_require_json_list)

    @model_validator(mode="after")
    def validate_unique_evidence(self) -> "LiaisonClaim":
        if len(self.evidenceIds) != len(set(self.evidenceIds)):
            raise ValueError("claim evidence ids must be unique")
        return self


class LiaisonError(StrictModel):
    code: StrictIdentifier
    category: Literal["validation", "authorization", "not_found", "dependency", "provider_permanent"]
    message: StrictStr = Field(min_length=1, max_length=500)
    retryable: StrictBool


class LiaisonAnswer(StrictModel):
    status: Literal["success", "no_data", "error"]
    answer: StrictStr = Field(min_length=1, max_length=4_000)
    skillName: Literal[
        "trend-scan", "job-status", "signal-watch", "posting-schedule", "engagement-insights",
    ]
    claims: list[LiaisonClaim] = Field(max_length=20)
    error: LiaisonError | None
    uncertainty: list[StrictAssumptionText] = Field(max_length=8)

    _require_lists = field_validator("claims", "uncertainty", mode="before")(_require_json_list)

    @model_validator(mode="after")
    def validate_status_shape(self) -> "LiaisonAnswer":
        if self.status == "error":
            if self.error is None or self.claims:
                raise ValueError("error answer requires one typed error and no claims")
        elif self.error is not None:
            raise ValueError("non-error answer cannot contain an error")
        if self.status == "success" and not self.claims:
            raise ValueError("successful liaison answer requires grounded claims")
        if self.status == "no_data" and self.claims:
            raise ValueError("no-data liaison answer cannot contain factual claims")
        return self
