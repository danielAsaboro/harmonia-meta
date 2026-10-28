"""Typed Harmonia-owned handoffs shared by every specialist."""

from __future__ import annotations

from functools import lru_cache
from hashlib import sha256
import json
from pathlib import Path
from typing import Any, Literal

from google.adk.skills import load_skill_from_dir
from pydantic import BaseModel, ConfigDict, Field


HANDOFF_PROTOCOL_VERSION = "harmonia.handoff/v1"
HANDOFF_SKILL_NAME = "harmonia-handoff-recovery"
HANDOFF_SKILL_ROOT = Path(__file__).parent / "skills" / HANDOFF_SKILL_NAME
HANDOFF_PROTOCOL_REFERENCE = "references/protocol.md"
MAX_HANDOFF_REPAIR_ATTEMPTS = 2


def _to_camel(value: str) -> str:
    head, *tail = value.split("_")
    return head + "".join(part.capitalize() for part in tail)


class _WireModel(BaseModel):
    model_config = ConfigDict(
        extra="forbid", frozen=True, alias_generator=_to_camel, populate_by_name=True,
    )


class HandoffEnvelope(_WireModel):
    protocol_version: Literal["harmonia.handoff/v1"] = HANDOFF_PROTOCOL_VERSION
    handoff_id: str = Field(pattern=r"^handoff-[a-f0-9]{24}$")
    sender: Literal["harmonia_coordinator"] = "harmonia_coordinator"
    receiver: str = Field(min_length=1, max_length=80)
    task: str = Field(min_length=1, max_length=80)
    operation_id: str = Field(min_length=1, max_length=300)
    input_digest: str = Field(pattern=r"^[a-f0-9]{64}$")
    expected_output: str = Field(min_length=1, max_length=100)
    authority_mode: Literal["preserve_pinned_authority"] = "preserve_pinned_authority"


class HandoffAcknowledgement(_WireModel):
    protocol_version: Literal["harmonia.handoff/v1"] = HANDOFF_PROTOCOL_VERSION
    handoff_id: str = Field(pattern=r"^handoff-[a-f0-9]{24}$")
    receiver: str = Field(min_length=1, max_length=80)
    status: Literal["accepted"] = "accepted"
    input_digest: str = Field(pattern=r"^[a-f0-9]{64}$")


EXPECTED_OUTPUTS = {
    "harmonia_intent_router": "IntentClassification",
    "harmonia_context_assembler": "IntentStrategyContext",
    "nimi_analyst": "SourceAnalysis",
    "ryan_strategist": "StrategistResult",
    "temi_editorial_planner": "EditorialPlan",
    "noni_copywriter": "ContentDraft",
    "dara_editor": "EditorialAssessment",
    "noni_artifact_producer": "ProductionBatch",
    "dara_artifact_editor": "ArtifactReviewBatch",
    "maya_presenter": "SurfacePlan",
    "nova_liaison": "LiaisonAnswer",
}


@lru_cache(maxsize=1)
def harmonia_handoff_skill_context() -> str:
    skill = load_skill_from_dir(HANDOFF_SKILL_ROOT)
    if skill.frontmatter.name != HANDOFF_SKILL_NAME:
        raise RuntimeError("Harmonia handoff skill name does not match its runtime contract")
    references = skill.resources.model_dump().get("references") or {}
    reference = references.get(Path(HANDOFF_PROTOCOL_REFERENCE).name)
    if not isinstance(reference, str) or not reference.strip():
        raise RuntimeError("Harmonia handoff protocol reference is missing")
    return "\n".join((
        f"Harmonia shared protocol {HANDOFF_PROTOCOL_VERSION}:",
        skill.instructions,
        f"\n## Loaded {HANDOFF_PROTOCOL_REFERENCE}",
        reference,
    ))


def build_handoff(
    *, specialist: str, payload: dict, operation_id: str,
) -> tuple[HandoffEnvelope, HandoffAcknowledgement]:
    try:
        expected_output = EXPECTED_OUTPUTS[specialist]
    except KeyError as exc:
        raise ValueError(f"unsupported handoff receiver: {specialist}") from exc
    serialized = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    input_digest = sha256(serialized.encode("utf-8")).hexdigest()
    identity = sha256(
        f"{operation_id}|{specialist}|{input_digest}|{expected_output}".encode()
    ).hexdigest()[:24]
    envelope = HandoffEnvelope(
        handoff_id=f"handoff-{identity}", receiver=specialist, task=specialist,
        operation_id=operation_id, input_digest=input_digest,
        expected_output=expected_output,
    )
    acknowledgement = HandoffAcknowledgement(
        handoff_id=envelope.handoff_id, receiver=specialist, input_digest=input_digest,
    )
    return envelope, acknowledgement


def repair_request(
    error: Exception,
    *,
    attempt: int,
    max_attempts: int = MAX_HANDOFF_REPAIR_ATTEMPTS,
    original_input: dict[str, Any] | None = None,
) -> dict[str, Any]:
    if attempt < 1 or attempt > max_attempts:
        raise ValueError("repair attempt must be within the bounded repair budget")
    code = str(getattr(error, "code", "invalid_agent_output"))
    instructions = {
        "missing_planning_snapshot_read": (
            "Regenerate the complete output from the original typed input. Before returning it, "
            "call at least one request-bound planning snapshot read tool with the exact supplied "
            "snapshot ID; preserve the approved strategy digest and all authority boundaries."
        ),
        "unknown_evidence_reference": (
            "Regenerate the complete output from the original typed input. Use only exact evidence "
            "IDs present in that input; do not create labels, aliases, or contextual pseudo-IDs."
        ),
        "invalid_skill_trace": (
            "Regenerate the complete output from the original typed input after completing the "
            "role's required skill and request-bound tool sequence exactly once."
        ),
        "incoherent_semantic_fields": (
            "Regenerate the complete output from the original typed input and correct every "
            "semantic relationship: visualHook must appear if and only if visualEvidenceIds are "
            "non-empty; high confidence requires an empty assumptions list; angleType must match "
            "evidenceKind; endSec must not precede startSec; and IDs and reference lists must be unique."
        ),
        "invalid_intent_classification": (
            "Regenerate the complete route from the original typed input. An explicit request to "
            "plan, establish, revise, build, create, make, generate, produce, prepare, draft, "
            "repurpose, schedule, publish, export, approve, show, check, "
            "or get status is operational and cannot be conversation. If planning or calendar work "
            "is requested without an approved workspace strategy, route to establish_strategy and "
            "either supply a fully typed strategyContext from known facts and explicit assumptions "
            "or ask one blocking clarification. Never invent facts or authority."
        ),
    }
    request: dict[str, Any] = {
        "attempt": attempt,
        "maxAttempts": max_attempts,
        "code": code,
        "path": str(getattr(error, "path", None) or "output"),
        "instruction": instructions.get(code, (
            "Regenerate the complete output from the original typed input and satisfy the "
            "declared schema, evidence IDs, authority boundary, and role contract."
        )),
    }
    if code == "missing_planning_snapshot_read":
        snapshot = (original_input or {}).get("planningSnapshot")
        snapshot_id = snapshot.get("snapshotId") if isinstance(snapshot, dict) else None
        if isinstance(snapshot_id, str) and snapshot_id:
            request["requiredToolCall"] = {
                "name": "read_production_capacity",
                "args": {"snapshot_id": snapshot_id},
            }
            request["instruction"] = (
                "Regenerate the complete output from the original typed input. Load the Temi "
                "skill and one approved reference first, then call the request-bound planning "
                f"snapshot read tool `read_production_capacity` with snapshot_id `{snapshot_id}` "
                "before returning JSON. Preserve the approved strategy digest and every "
                "authority boundary."
            )
    return request
