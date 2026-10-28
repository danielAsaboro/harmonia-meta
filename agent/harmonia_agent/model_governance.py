"""Append-only, human-governed model promotion and exact rollback records."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
from datetime import datetime
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter

from .evaluation_report import RoleComparison


class _Event(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class CandidateEvent(_Event):
    type: Literal["candidate"] = "candidate"
    candidate_id: str = Field(min_length=1)
    role: str = Field(min_length=1)
    current_model: str = Field(min_length=1)
    proposed_model: str = Field(min_length=1)
    eval_run_id: str = Field(min_length=1)
    evidence_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    proposed_by: str = Field(min_length=1)
    created_at: datetime


class ReviewEvent(_Event):
    type: Literal["review"] = "review"
    review_id: str = Field(min_length=1)
    candidate_id: str = Field(min_length=1)
    decision: Literal["approved", "rejected"]
    reviewed_by: str = Field(min_length=1)
    reviewed_at: datetime
    note: str = Field(min_length=1, max_length=2000)


class PromotionEvent(_Event):
    type: Literal["promotion"] = "promotion"
    promotion_id: str = Field(min_length=1)
    candidate_id: str = Field(min_length=1)
    review_id: str = Field(min_length=1)
    activated_by: str = Field(min_length=1)
    activated_at: datetime


class RollbackEvent(_Event):
    type: Literal["rollback"] = "rollback"
    rollback_id: str = Field(min_length=1)
    promotion_id: str = Field(min_length=1)
    reason: str = Field(min_length=1, max_length=2000)
    rolled_back_by: str = Field(min_length=1)
    rolled_back_at: datetime


GovernanceEvent = Annotated[
    CandidateEvent | ReviewEvent | PromotionEvent | RollbackEvent,
    Field(discriminator="type"),
]
EVENT_ADAPTER = TypeAdapter(GovernanceEvent)


def candidate_from_comparison(
    comparison: RoleComparison,
    *,
    candidate_id: str,
    current_model: str,
    proposed_by: str,
    created_at: datetime,
) -> CandidateEvent:
    """Create a candidate only from the report's eligible, selected real-evidence record."""
    if comparison.selected_model is None:
        raise ValueError("comparison has no selected model")
    matches = [
        record for record in comparison.eligible
        if record.model_id == comparison.selected_model
    ]
    if len(matches) != 1:
        raise ValueError("selected model is not uniquely present in eligible evidence")
    selected = matches[0]
    return CandidateEvent(
        candidate_id=candidate_id,
        role=comparison.role,
        current_model=current_model,
        proposed_model=selected.model_id,
        eval_run_id=selected.eval_run_id,
        evidence_digest=selected.evidence_digest,
        proposed_by=proposed_by,
        created_at=created_at,
    )


class LedgerRecord(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    sequence: int = Field(ge=1)
    previous_digest: str | None = Field(default=None, pattern=r"^[0-9a-f]{64}$")
    event: GovernanceEvent
    digest: str = Field(pattern=r"^[0-9a-f]{64}$")


class GovernanceState(BaseModel):
    model_config = ConfigDict(arbitrary_types_allowed=True)
    records: list[LedgerRecord] = Field(default_factory=list)
    candidates: dict[str, CandidateEvent] = Field(default_factory=dict)
    reviews: dict[str, ReviewEvent] = Field(default_factory=dict)
    promotions: dict[str, PromotionEvent] = Field(default_factory=dict)
    rolled_back: set[str] = Field(default_factory=set)
    active_models: dict[str, str] = Field(default_factory=dict)


def _canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode()


def _record_digest(sequence: int, previous: str | None, event: GovernanceEvent) -> str:
    body = {
        "sequence": sequence,
        "previousDigest": previous,
        "event": event.model_dump(mode="json"),
    }
    return hashlib.sha256(_canonical(body)).hexdigest()


def _apply(state: GovernanceState, event: GovernanceEvent) -> None:
    if isinstance(event, CandidateEvent):
        if event.candidate_id in state.candidates:
            raise ValueError("candidate ID already exists")
        if event.current_model == event.proposed_model:
            raise ValueError("candidate must change the model")
        active = state.active_models.get(event.role)
        if active is not None and active != event.current_model:
            raise ValueError("candidate current model does not match governed active model")
        state.active_models.setdefault(event.role, event.current_model)
        state.candidates[event.candidate_id] = event
        return
    if isinstance(event, ReviewEvent):
        candidate = state.candidates.get(event.candidate_id)
        if candidate is None:
            raise ValueError("review references unknown candidate")
        if event.review_id in state.reviews:
            raise ValueError("review ID already exists")
        if any(item.candidate_id == event.candidate_id for item in state.reviews.values()):
            raise ValueError("candidate already has a review")
        if event.reviewed_by == candidate.proposed_by:
            raise ValueError("approval requires an independent reviewer")
        state.reviews[event.review_id] = event
        return
    if isinstance(event, PromotionEvent):
        candidate = state.candidates.get(event.candidate_id)
        review = state.reviews.get(event.review_id)
        if candidate is None or review is None or review.candidate_id != event.candidate_id:
            raise ValueError("promotion requires the candidate's approved review")
        if review.decision != "approved":
            raise ValueError("promotion requires an approved review")
        if event.promotion_id in state.promotions:
            raise ValueError("promotion ID already exists")
        if any(item.candidate_id == event.candidate_id for item in state.promotions.values()):
            raise ValueError("candidate already promoted")
        if state.active_models.get(candidate.role) != candidate.current_model:
            raise ValueError("active model changed after candidate evaluation")
        state.promotions[event.promotion_id] = event
        state.active_models[candidate.role] = candidate.proposed_model
        return
    if event.rollback_id in {
        item.rollback_id
        for record in state.records
        if isinstance((item := record.event), RollbackEvent)
    }:
        raise ValueError("rollback ID already exists")
    promotion = state.promotions.get(event.promotion_id)
    if promotion is None or event.promotion_id in state.rolled_back:
        raise ValueError("rollback requires an active promotion")
    candidate = state.candidates[promotion.candidate_id]
    if state.active_models.get(candidate.role) != candidate.proposed_model:
        raise ValueError("promotion is no longer the active model")
    state.active_models[candidate.role] = candidate.current_model
    state.rolled_back.add(event.promotion_id)


def load_ledger(path: Path) -> GovernanceState:
    state = GovernanceState()
    if not path.exists():
        return state
    previous: str | None = None
    for expected_sequence, line in enumerate(path.read_text().splitlines(), start=1):
        if not line.strip():
            continue
        record = LedgerRecord.model_validate_json(line)
        if record.sequence != expected_sequence or record.previous_digest != previous:
            raise ValueError("governance ledger sequence or previous digest is invalid")
        expected = _record_digest(record.sequence, record.previous_digest, record.event)
        if record.digest != expected:
            raise ValueError("governance ledger record digest is invalid")
        _apply(state, record.event)
        state.records.append(record)
        previous = record.digest
    return state


def append_event(path: Path, event: GovernanceEvent) -> LedgerRecord:
    """Validate and durably append one hash-chained governance event under a file lock."""
    event = EVENT_ADAPTER.validate_python(event)
    path = path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    lock_path = path.with_suffix(path.suffix + ".lock")
    with lock_path.open("a+") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        state = load_ledger(path)
        _apply(state, event)
        sequence = len(state.records) + 1
        previous = state.records[-1].digest if state.records else None
        record = LedgerRecord(
            sequence=sequence,
            previous_digest=previous,
            event=event,
            digest=_record_digest(sequence, previous, event),
        )
        with path.open("a", encoding="utf-8") as stream:
            stream.write(record.model_dump_json(by_alias=True) + "\n")
            stream.flush()
            os.fsync(stream.fileno())
        fcntl.flock(lock.fileno(), fcntl.LOCK_UN)
    return record
