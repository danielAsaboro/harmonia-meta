"""Exact-scope, durable context through Vertex AI Agent Engine Memory Bank."""

from __future__ import annotations

import json
from typing import Any, Literal, Protocol

from pydantic import BaseModel, ConfigDict, Field

from .telemetry import safe_attributes, tracer


class MemoryProtocolError(RuntimeError):
    """Memory Bank returned a malformed response or an ineligible write."""


class MemoryProviderError(RuntimeError):
    """Memory Bank transport or provider execution failed."""


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


def _fact_from_result(result: Any) -> str | None:
    if isinstance(result, dict):
        memory = result.get("memory") or {}
        return memory.get("fact") if isinstance(memory, dict) else getattr(memory, "fact", None)
    memory = getattr(result, "memory", None)
    return getattr(memory, "fact", None)


class VertexMemoryBank:
    def __init__(self, *, resource_name: str, client: Any | None = None) -> None:
        if not resource_name.startswith("projects/") or "/reasoningEngines/" not in resource_name:
            raise ValueError("MEMORY_BANK_RESOURCE must be a full reasoning engine resource name")
        self.resource_name = resource_name
        self._client = client

    def _memories(self) -> Any:
        client = self._client
        if client is None:
            try:
                import vertexai
            except ImportError as exc:  # pragma: no cover - deployment dependency
                raise MemoryProviderError(
                    "google-cloud-aiplatform Memory Bank support is not installed"
                ) from exc
            client = vertexai.Client()
        return client.agent_engines.memories

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
                results = self._memories().retrieve(
                    name=self.resource_name,
                    scope=scope.to_wire(),
                    similarity_search_params={
                        "search_query": query[:1000],
                        "top_k": bounded_top_k,
                    },
                )
                facts: list[MemoryFact] = []
                for result in results:
                    raw = _fact_from_result(result)
                    if not isinstance(raw, str) or not raw.strip():
                        raise MemoryProtocolError("Memory Bank result is missing a valid fact")
                    try:
                        fact = MemoryFact.model_validate_json(raw)
                    except Exception as exc:
                        raise MemoryProtocolError("Memory Bank fact is missing typed evidence") from exc
                    if fact.evidence_ref.workspace_id != scope.workspace_id or fact.evidence_ref.brand_id != scope.brand_id:
                        raise MemoryProtocolError("Memory Bank returned a cross-scope fact")
                    facts.append(fact)
                span.set_attribute("memory.result_count", len(facts))
                return facts
            except MemoryProtocolError:
                raise
            except Exception as exc:  # noqa: BLE001 - provider boundary
                raise MemoryProviderError(f"Memory Bank retrieval failed: {exc}") from exc

    def generate(self, *, scope: MemoryScope, candidates: list[MemoryCandidate]) -> None:
        if not candidates:
            return
        if len(candidates) > 5:
            raise MemoryProtocolError("Memory Bank accepts at most five eligible facts per write")
        validated = [MemoryCandidate.model_validate(candidate) for candidate in candidates]
        if any(
            item.evidence_ref.workspace_id != scope.workspace_id
            or item.evidence_ref.brand_id != scope.brand_id
            for item in validated
        ):
            raise MemoryProtocolError("Memory Bank candidate evidence does not match retrieval scope")
        with tracer().start_as_current_span("harmonia.memory.generate") as span:
            span.set_attributes(safe_attributes({
                "workspace.id": scope.workspace_id,
                "brand.id": scope.brand_id,
                "memory.fact_count": len(validated),
            }))
            try:
                self._memories().generate(
                    name=self.resource_name,
                    scope=scope.to_wire(),
                    direct_memories_source={
                        "direct_memories": [{
                            "fact": json.dumps(item.model_dump(mode="json"), sort_keys=True, separators=(",", ":")),
                        } for item in validated],
                    },
                )
            except Exception as exc:  # noqa: BLE001 - provider boundary
                raise MemoryProviderError(f"Memory Bank generation failed: {exc}") from exc


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
