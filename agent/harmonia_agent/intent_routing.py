"""Strict, skill-owned routing for natural Harmonia operator requests."""

from __future__ import annotations

import pathlib
import re
from typing import Literal

from google.adk.skills import load_skill_from_dir
from google.adk.tools import FunctionTool, skill_toolset
from pydantic import ConfigDict, Field, StrictBool, StrictInt, StrictStr, model_validator

from .agent_models import AudienceSegment, StrategyResearchRequest, StrictModel
from . import web_client
from .tool_contracts import evidence, provider_error, success

SKILL_DIR = pathlib.Path(__file__).parent / "skills" / "harmonia-intent-routing"
CONTEXT_SKILL_DIR = pathlib.Path(__file__).parent / "skills" / "harmonia-context-assembly"

IntentName = Literal[
    "establish_strategy", "revise_strategy", "advance_plan", "manage_calendar",
    "repurpose_source", "one_off_content", "status_evidence", "effect_request",
    "conversation",
]
OutputConcept = Literal[
    "short_social_post", "social_thread", "professional_post", "article",
    "newsletter", "caption", "carousel", "social_image", "quote_card",
    "diagram", "short_video", "calendar", "content_package",
]
SocialPlatform = Literal["x", "linkedin", "linkedin-organization", "instagram", "tiktok"]


def get_social_platform_connections() -> dict:
    """Read safe connection state for Harmonia's supported social platforms."""
    try:
        connections = [item for item in web_client.get_platform_connections() if item.get("id") in {"x", "linkedin", "linkedin-organization", "instagram", "tiktok"}]
        return success(
            {"platforms": connections},
            evidence_items=[evidence("harmonia_platform_connections", provenance="live")],
        )
    except Exception as exc:  # noqa: BLE001 - normalized tool boundary
        return provider_error(exc)


class RecentJobSummary(StrictModel):
    id: StrictStr = Field(min_length=1, max_length=128)
    stage: StrictStr = Field(min_length=1, max_length=64)
    status: StrictStr = Field(min_length=1, max_length=64)
    title: StrictStr | None = Field(default=None, max_length=2_000)


class WorkspaceContentContext(StrictModel):
    strategyReady: StrictBool
    planReady: StrictBool
    calendarReady: StrictBool
    pendingApprovalCount: StrictInt = Field(ge=0, le=1000)
    goals: list[StrictStr] = Field(max_length=12)
    channels: list[StrictStr] = Field(max_length=12)
    strategySummary: StrictStr | None = Field(default=None, max_length=1000)
    planSummary: StrictStr | None = Field(default=None, max_length=1000)
    upcomingItemCount: StrictInt = Field(default=0, ge=0, le=1000)
    recentJobs: list[RecentJobSummary] = Field(max_length=8)


class ConversationTurn(StrictModel):
    role: Literal["user", "assistant"]
    text: StrictStr = Field(min_length=1, max_length=2000)


class IntentRoutingInput(StrictModel):
    message: StrictStr = Field(min_length=1, max_length=2000)
    workspaceContext: WorkspaceContentContext
    attachmentCount: StrictInt = Field(ge=0, le=10)
    recentConversation: list[ConversationTurn] = Field(default_factory=list, max_length=8)


def source_urls_from_input(value: IntentRoutingInput) -> list[str]:
    """Return only HTTP(S) URLs the operator or prior conversation supplied verbatim."""
    urls: list[str] = []
    for text in [*(turn.text for turn in value.recentConversation), value.message]:
        for match in re.findall(r"https?://[^\s<>\"']+", text):
            url = match.rstrip(".,;:!?)]}")
            if url and url not in urls:
                urls.append(url)
    return urls


def deterministic_intent_classification(
    value: IntentRoutingInput,
) -> IntentClassification | None:
    """Classify syntax that carries no model judgment; return None when ambiguous."""
    urls = source_urls_from_input(value)
    message = value.message.casefold()
    if urls and re.search(
        r"\b(?:repurpose|transcribe|analy[sz]e|clip|turn|transform|convert)\b",
        message,
    ):
        platforms: list[SocialPlatform] = []
        for platform, markers in (
            ("linkedin", ("linkedin",)),
            ("instagram", ("instagram",)),
            ("tiktok", ("tiktok", "tik tok")),
            ("x", (" twitter", " x ")),
        ):
            if any(marker in f" {message} " for marker in markers):
                platforms.append(platform)  # type: ignore[arg-type]
        outputs: list[OutputConcept] = []
        if "linkedin" in platforms:
            outputs.append("professional_post")
        if re.search(r"\b(?:content package|content pack|exportable)\b", message):
            outputs.append("content_package")
        if re.search(r"\b(?:short video|short clip|video clip)\b", message):
            outputs.append("short_video")
        if not outputs:
            outputs.append("short_social_post")
        return IntentClassification(
            intent="repurpose_source",
            userOutcome="Repurpose the supplied source into the requested content.",
            sourceUrls=urls,
            outputConcepts=outputs,
            platformRecommendations=platforms,
            assumptions=[],
            needsClarification=False,
            clarifyingQuestion=None,
            requiresRightsAttestation=any(
                "youtube.com" in url or "youtu.be" in url for url in urls
            ),
            effectRequested=False,
            jobId=None,
        )
    return None


class IntentStrategyContext(StrictModel):
    company: StrictStr = Field(min_length=1, max_length=200)
    product: StrictStr = Field(min_length=1, max_length=500)
    positioning: StrictStr = Field(min_length=1, max_length=500)
    differentiators: list[StrictStr] = Field(min_length=1, max_length=8)
    brandVoice: list[StrictStr] = Field(min_length=1, max_length=8)
    exclusions: list[StrictStr] = Field(default_factory=list, max_length=12)
    safetyConstraints: list[StrictStr] = Field(default_factory=list, max_length=12)
    businessObjectives: list[StrictStr] = Field(min_length=1, max_length=8)
    campaignObjectives: list[StrictStr] = Field(min_length=1, max_length=8)
    audiences: list[AudienceSegment] = Field(min_length=1, max_length=6)
    funnelStage: Literal["awareness", "consideration", "conversion", "retention", "advocacy"]
    intendedConversion: StrictStr = Field(min_length=1, max_length=300)
    requestedChannels: list[StrictStr] = Field(min_length=1, max_length=8)
    supportedChannels: list[StrictStr] = Field(min_length=1, max_length=8)
    horizonWeeks: StrictInt = Field(default=4, ge=1, le=12)
    researchRequest: StrategyResearchRequest | None = None


class IntentClassification(StrictModel):
    """Small routing contract; strategy assembly is a separate bounded delegation."""

    intent: IntentName
    userOutcome: StrictStr = Field(min_length=1, max_length=500)
    sourceUrls: list[StrictStr] = Field(max_length=10)
    outputConcepts: list[OutputConcept] = Field(max_length=8)
    platformRecommendations: list[SocialPlatform] = Field(max_length=5)
    assumptions: list[StrictStr] = Field(max_length=8)
    needsClarification: StrictBool
    clarifyingQuestion: StrictStr | None = Field(default=None, max_length=300)
    requiresRightsAttestation: StrictBool
    effectRequested: StrictBool
    jobId: StrictStr | None = Field(default=None, max_length=128)

    @model_validator(mode="after")
    def enforce_question_shape(self) -> "IntentClassification":
        if self.effectRequested != (self.intent == "effect_request"):
            raise ValueError("effectRequested must match the effect_request intent")
        if self.needsClarification != bool(self.clarifyingQuestion):
            raise ValueError("clarifyingQuestion must match needsClarification")
        return self


class StrategyContextAssemblyInput(StrictModel):
    message: StrictStr = Field(min_length=1, max_length=2000)
    recentConversation: list[ConversationTurn] = Field(default_factory=list, max_length=8)
    userOutcome: StrictStr = Field(min_length=1, max_length=500)
    sourceUrls: list[StrictStr] = Field(max_length=10)
    outputConcepts: list[OutputConcept] = Field(max_length=8)
    requestedChannels: list[SocialPlatform] = Field(max_length=5)


class IntentRoute(StrictModel):
    model_config = ConfigDict(extra="forbid")

    intent: IntentName
    userOutcome: StrictStr = Field(min_length=1, max_length=500)
    sourceUrls: list[StrictStr] = Field(max_length=10)
    outputConcepts: list[OutputConcept] = Field(max_length=8)
    platformRecommendations: list[SocialPlatform] = Field(max_length=5)
    connectionSuggestions: list[SocialPlatform] = Field(max_length=5)
    assumptions: list[StrictStr] = Field(max_length=8)
    needsClarification: StrictBool
    clarifyingQuestion: StrictStr | None = Field(default=None, max_length=300)
    requiresRightsAttestation: StrictBool
    effectRequested: StrictBool
    effectAuthorized: StrictBool = False
    jobId: StrictStr | None = Field(default=None, max_length=128)
    strategyContext: IntentStrategyContext | None = None

    @model_validator(mode="after")
    def enforce_authority_and_question_shape(self) -> "IntentRoute":
        if self.effectAuthorized:
            raise ValueError("intent routing cannot authorize an external effect")
        if self.effectRequested != (self.intent == "effect_request"):
            raise ValueError("effectRequested must match the effect_request intent")
        if self.needsClarification != bool(self.clarifyingQuestion):
            raise ValueError("clarifyingQuestion must match needsClarification")
        if not set(self.connectionSuggestions).issubset(self.platformRecommendations):
            raise ValueError("connection suggestions must be recommended platforms")
        if re.search(
            r"\b(?:has|have|had|was|were)\s+(?:successfully\s+|already\s+)?"
            r"(?:accepted|extracted|parsed|prepared|repurposed|completed|published|verified|executed)\b"
            r"|\bsuccessfully\s+(?:accepted|extracted|parsed|prepared|repurposed|completed|published|verified|executed)\b",
            self.userOutcome.casefold(),
        ):
            raise ValueError("userOutcome must describe the desired future outcome, not claim completed work")
        if (
            self.intent in {"establish_strategy", "revise_strategy"}
            and self.sourceUrls
            and not self.needsClarification
            and self.strategyContext is None
        ):
            raise ValueError("strategy context is required before starting a strategy job")
        return self


def build_intent_routing_skillset() -> skill_toolset.SkillToolset:
    """Load the policy skill owned by Harmonia; it exposes no effect tools."""
    return skill_toolset.SkillToolset(
        skills=[load_skill_from_dir(SKILL_DIR)],
        additional_tools=[FunctionTool(get_social_platform_connections)],
    )


def compiled_intent_routing_skill_context() -> str:
    """Compile Harmonia's owned routing skill for a one-response typed handoff."""
    instructions = (SKILL_DIR / "SKILL.md").read_text(encoding="utf-8")
    instructions = instructions.replace(
        "Call `get_social_platform_connections` once before recommending distribution channels. "
        "Treat only `connected: true` as connected.",
        "The trusted routing host calls `get_social_platform_connections` once and reconciles "
        "your recommendations against its live result after this typed response. Recommend channels "
        "for strategic fit; do not guess connection state or omit a useful disconnected channel.",
    )
    return (
        "# Coordinator-compiled Harmonia intent-routing skill\n"
        "Activation: coordinator_compiled\n"
        "The immutable skill below is already loaded. Do not request or load it again.\n\n"
        f"{instructions.strip()}"
    )


def compiled_context_assembly_skill_context() -> str:
    """Compile Harmonia's narrow context-assembly skill for one typed response."""
    skill = load_skill_from_dir(CONTEXT_SKILL_DIR)
    if skill.frontmatter.name != "harmonia-context-assembly":
        raise RuntimeError("Harmonia context assembly skill name does not match")
    return (
        "# Coordinator-compiled Harmonia context-assembly skill\n"
        "Activation: coordinator_compiled\n"
        "The immutable skill below is already loaded. Do not request or load it again.\n\n"
        f"{skill.instructions.strip()}"
    )
