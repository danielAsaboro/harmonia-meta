"""Exact-scope, durable workspace memory stored by the web service in Firestore."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from .telemetry import safe_attributes, tracer


class MemoryProtocolError(RuntimeError):
    """The memory store returned a malformed response or an ineligible write."""


class MemoryProviderError(RuntimeError):
    """The memory store transport failed."""


class MemoryScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    workspace_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    brand_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")

    def to_wire(self) -> dict[str, str]:
        return {"workspace_id": self.workspace_id, "brand_id": self.brand_id}


class MemoryCandidate(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: Literal["operator_decision", "verified_outcome", "learning", "preference"]
    fact: str = Field(min_length=1, max_length=1000)
    evidence_ref: "MemoryEvidenceRef"


class MemoryEvidenceRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    workspace_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    brand_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    job_id: str = Field(min_length=1, max_length=128, pattern=r"^[A-Za-z0-9._-]+$")
    kind: Literal["decision", "receipt", "verification", "learning"]
    record_id: str = Field(min_length=1, max_length=240, pattern=r"^[A-Za-z0-9._:-]+$")


class MemoryFact(MemoryCandidate):
    pass


class MemoryBank(Protocol):
    def retrieve(self, *, scope: MemoryScope, query: str, top_k: int = 3) -> list[MemoryFact]: ...

    def generate(self, *, scope: MemoryScope, candidates: list[MemoryCandidate]) -> None: ...


class WorkspaceMemoryBank:
    """Facts live in the tenant's Firestore workspace behind the internal web API.

    Retrieval ranks facts by shared words with the query; there is no embedding
    model, so a fact must use the query's vocabulary to be found.
    """

    def __init__(self, *, post: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None) -> None:
        self._post = post

    def _call(self, path: str, payload: dict[str, Any]) -> dict[str, Any]:
        if self._post is None:
            from .web_client import post
            return post(path, payload)
        return self._post(path, payload)

    def retrieve(self, *, scope: MemoryScope, query: str, top_k: int = 3) -> list[MemoryFact]:
        if not query.strip():
            return []
        bounded_top_k = min(max(top_k, 1), 5)
        with tracer().start_as_current_span("harmonia.memory.retrieve") as span:
            span.set_attributes(safe_attributes({
                "workspace.id": scope.workspace_id,
                "brand.id": scope.brand_id,
                "memory.top_k": bounded_top_k,
            }))
            try:
                response = self._call("/api/internal/memory/search", {
                    "brandId": scope.brand_id, "query": query[:1000], "topK": bounded_top_k,
                })
            except Exception as exc:  # noqa: BLE001 - provider boundary
                raise MemoryProviderError(f"memory retrieval failed: {exc}") from exc
            raw_facts = response.get("facts") if isinstance(response, dict) else None
            if not isinstance(raw_facts, list):
                raise MemoryProtocolError("memory search returned no fact list")
            facts: list[MemoryFact] = []
            for raw in raw_facts:
                try:
                    fact = MemoryFact.model_validate(raw)
                except Exception as exc:
                    raise MemoryProtocolError("memory fact is missing typed evidence") from exc
                if fact.evidence_ref.workspace_id != scope.workspace_id or fact.evidence_ref.brand_id != scope.brand_id:
                    raise MemoryProtocolError("memory store returned a cross-scope fact")
                facts.append(fact)
            span.set_attribute("memory.result_count", len(facts))
            return facts

    def generate(self, *, scope: MemoryScope, candidates: list[MemoryCandidate]) -> None:
        if not candidates:
            return
        if len(candidates) > 5:
            raise MemoryProtocolError("memory accepts at most five eligible facts per write")
        validated = [MemoryCandidate.model_validate(candidate) for candidate in candidates]
        if any(
            item.evidence_ref.workspace_id != scope.workspace_id
            or item.evidence_ref.brand_id != scope.brand_id
            for item in validated
        ):
            raise MemoryProtocolError("memory candidate evidence does not match retrieval scope")
        with tracer().start_as_current_span("harmonia.memory.generate") as span:
            span.set_attributes(safe_attributes({
                "workspace.id": scope.workspace_id,
                "brand.id": scope.brand_id,
                "memory.fact_count": len(validated),
            }))
            try:
                self._call("/api/internal/memory", {
                    "brandId": scope.brand_id,
                    "facts": [item.model_dump(mode="json") for item in validated],
                })
            except Exception as exc:  # noqa: BLE001 - provider boundary
                raise MemoryProviderError(f"memory write failed: {exc}") from exc


def format_memory_context(facts: list[MemoryFact], *, max_chars: int = 3500) -> str:
    """Bound retrieved facts before they enter an agent input contract."""
    lines: list[str] = []
    used = 0
    for fact in facts[:5]:
        line = f"- {fact.fact.strip()} [evidence:{fact.evidence_ref.kind}/{fact.evidence_ref.record_id}]"
        if not fact.fact.strip() or used + len(line) > max_chars:
            break
        lines.append(line)
        used += len(line) + 1
    return "\n".join(lines)


def eligible_job_memories(job: dict[str, Any], *, measured_posts: int) -> list[MemoryCandidate]:
    """Extract only durable decisions/outcomes; never raw creative or source content."""
    # Engagement is not durable until the later web write succeeds, so this pre-write
    # memory step deliberately does not claim `measured_posts` as evidence.
    _ = measured_posts
    actions = job.get("actions") or []
    workspace_id = str(job.get("workspaceId") or "")
    brand_id = str(job.get("brandId") or "")
    job_id = str(job.get("id") or "")
    if not workspace_id or not brand_id or not job_id:
        raise MemoryProtocolError("eligible memory job is missing durable scope identifiers")
    verifications = job.get("verifications") or job.get("verification") or []
    candidates: list[MemoryCandidate] = []
    for action in actions:
        decision = action.get("approvalState")
        action_id = action.get("id")
        if decision not in {"approved", "rejected"} or not action_id:
            continue
        candidates.append(MemoryCandidate(
            kind="operator_decision",
            fact=f"Operator {decision} 1 action in this job.",
            evidence_ref=MemoryEvidenceRef(
                workspace_id=workspace_id, brand_id=brand_id, job_id=job_id,
                kind="decision", record_id=str(action_id),
            ),
        ))
    for result in verifications:
        record_id = result.get("actionId") or result.get("target")
        if result.get("verified") is not True or not record_id:
            continue
        candidates.append(MemoryCandidate(
            kind="verified_outcome",
            fact="The job independently verified 1 external or stored outcome.",
            evidence_ref=MemoryEvidenceRef(
                workspace_id=workspace_id, brand_id=brand_id, job_id=job_id,
                kind="verification", record_id=str(record_id),
            ),
        ))
    return candidates[:5]
