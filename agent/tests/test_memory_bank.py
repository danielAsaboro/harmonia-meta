"""Exact-scope workspace memory behavior and eligible fact generation."""

from __future__ import annotations

import pytest

from harmonia_agent.memory_bank import (
    MemoryCandidate,
    MemoryEvidenceRef,
    MemoryFact,
    MemoryProtocolError,
    MemoryScope,
    WorkspaceMemoryBank,
    eligible_job_memories,
)


class _WebApi:
    def __init__(self, response=None) -> None:
        self.response = response if response is not None else {"facts": []}
        self.calls: list[tuple[str, dict]] = []

    def __call__(self, path, payload):
        self.calls.append((path, payload))
        return self.response


_FACT = {
    "kind": "preference", "fact": "Operators prefer direct, evidence-led hooks.",
    "evidence_ref": {"workspace_id": "workspace-1", "brand_id": "brand-a", "job_id": "job-1", "kind": "decision", "record_id": "a1"},
}


def test_memory_bank_retrieves_only_the_exact_workspace_and_brand_scope():
    api = _WebApi({"facts": [_FACT]})
    bank = WorkspaceMemoryBank(post=api)
    scope = MemoryScope(workspace_id="workspace-1", brand_id="brand-a")

    facts = bank.retrieve(scope=scope, query="video launch", top_k=9)

    assert facts == [MemoryFact(kind="preference", fact="Operators prefer direct, evidence-led hooks.", evidence_ref=MemoryEvidenceRef(workspace_id="workspace-1", brand_id="brand-a", job_id="job-1", kind="decision", record_id="a1"))]
    assert api.calls == [("/api/internal/memory/search", {"brandId": "brand-a", "query": "video launch", "topK": 5})]


def test_memory_bank_rejects_a_cross_scope_result():
    other = {**_FACT, "evidence_ref": {**_FACT["evidence_ref"], "brand_id": "brand-b"}}
    bank = WorkspaceMemoryBank(post=_WebApi({"facts": [other]}))
    with pytest.raises(MemoryProtocolError, match="cross-scope"):
        bank.retrieve(scope=MemoryScope(workspace_id="workspace-1", brand_id="brand-a"), query="launch")


def test_memory_bank_generates_only_typed_eligible_facts_in_the_same_scope():
    api = _WebApi({"saved": 2})
    bank = WorkspaceMemoryBank(post=api)
    scope = MemoryScope(workspace_id="workspace-1", brand_id="brand-a")

    bank.generate(scope=scope, candidates=[
        MemoryCandidate(kind="operator_decision", fact="Operator approved one publish action.", evidence_ref=MemoryEvidenceRef(workspace_id="workspace-1", brand_id="brand-a", job_id="job-1", kind="decision", record_id="a1")),
        MemoryCandidate(kind="verified_outcome", fact="One published post was independently verified.", evidence_ref=MemoryEvidenceRef(workspace_id="workspace-1", brand_id="brand-a", job_id="job-1", kind="verification", record_id="a1")),
    ])

    assert api.calls == [("/api/internal/memory", {"brandId": "brand-a", "facts": [
        {"kind": "operator_decision", "fact": "Operator approved one publish action.", "evidence_ref": {"workspace_id": "workspace-1", "brand_id": "brand-a", "job_id": "job-1", "kind": "decision", "record_id": "a1"}},
        {"kind": "verified_outcome", "fact": "One published post was independently verified.", "evidence_ref": {"workspace_id": "workspace-1", "brand_id": "brand-a", "job_id": "job-1", "kind": "verification", "record_id": "a1"}},
    ]})]


def test_memory_bank_rejects_malformed_results_instead_of_hiding_them():
    bank = WorkspaceMemoryBank(post=_WebApi({"facts": [{"distance": 0.1}]}))
    with pytest.raises(MemoryProtocolError, match="fact"):
        bank.retrieve(
            scope=MemoryScope(workspace_id="workspace-1", brand_id="brand-a"),
            query="launch",
        )


def test_learn_stage_memory_candidates_exclude_raw_content_and_unverified_claims():
    candidates = eligible_job_memories({
        "id": "job-1", "workspaceId": "workspace-1", "brandId": "brand-a",
        "actions": [
            {"id": "a1", "type": "publish_x_post", "approvalState": "approved", "state": "executed",
             "payload": {"text": "raw draft must never be memorized"}},
            {"id": "a2", "type": "generate_image", "approvalState": "rejected", "state": "skipped",
             "payload": {"prompt": "raw prompt must never be memorized"}},
        ],
        "verification": [
            {"actionId": "a1", "verified": True, "target": "x:123"},
            {"actionId": "a2", "verified": False, "target": "asset:a2"},
        ],
    }, measured_posts=1)

    facts = " ".join(candidate.fact for candidate in candidates)
    assert "raw draft" not in facts
    assert "raw prompt" not in facts
    assert "approved 1" in facts
    assert "rejected 1" in facts
    assert "independently verified 1" in facts
    assert all(candidate.evidence_ref.workspace_id == "workspace-1" for candidate in candidates)
    assert {candidate.evidence_ref.kind for candidate in candidates} == {"decision", "verification"}


def test_memory_generation_rejects_cross_scope_evidence():
    bank = WorkspaceMemoryBank(post=_WebApi())
    with pytest.raises(MemoryProtocolError, match="scope"):
        bank.generate(scope=MemoryScope(workspace_id="workspace-1", brand_id="brand-a"), candidates=[
            MemoryCandidate(kind="preference", fact="Use concise hooks.", evidence_ref=MemoryEvidenceRef(workspace_id="workspace-2", brand_id="brand-a", job_id="job-1", kind="decision", record_id="a1")),
        ])
