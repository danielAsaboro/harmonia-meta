"""Exact-scope Memory Bank behavior and eligible fact generation."""

from __future__ import annotations

import pytest

from harmonia_agent.memory_bank import (
    MemoryCandidate,
    MemoryEvidenceRef,
    MemoryFact,
    MemoryProtocolError,
    MemoryScope,
    VertexMemoryBank,
    eligible_job_memories,
)
from harmonia_agent.agent_models import AnalystInput
from harmonia_agent.agents import analyze_with_team
import asyncio
from tests.test_nimi_contracts import analyst_input


class _MemoryApi:
    def __init__(self, results=None) -> None:
        self.results = results or []
        self.retrieve_calls: list[dict] = []
        self.generate_calls: list[dict] = []

    def retrieve(self, **kwargs):
        self.retrieve_calls.append(kwargs)
        return self.results

    def generate(self, **kwargs):
        self.generate_calls.append(kwargs)
        return {"name": "operations/memory-1"}


class _Client:
    class _Engines:
        def __init__(self, memories):
            self.memories = memories

    def __init__(self, memories):
        self.agent_engines = self._Engines(memories)


def test_memory_bank_retrieves_only_the_exact_workspace_and_brand_scope():
    api = _MemoryApi(results=[
        {"memory": {"fact": '{"evidence_ref":{"brand_id":"brand-a","job_id":"job-1","kind":"decision","record_id":"a1","workspace_id":"workspace-1"},"fact":"Operators prefer direct, evidence-led hooks.","kind":"preference"}'}},
    ])
    bank = VertexMemoryBank(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(api),
    )
    scope = MemoryScope(workspace_id="workspace-1", brand_id="brand-a")

    facts = bank.retrieve(scope=scope, query="video launch", top_k=3)

    assert facts == [MemoryFact(kind="preference", fact="Operators prefer direct, evidence-led hooks.", evidence_ref=MemoryEvidenceRef(workspace_id="workspace-1", brand_id="brand-a", job_id="job-1", kind="decision", record_id="a1"))]
    assert api.retrieve_calls == [{
        "name": "projects/p/locations/us-central1/reasoningEngines/42",
        "scope": {"workspace_id": "workspace-1", "brand_id": "brand-a"},
        "similarity_search_params": {"search_query": "video launch", "top_k": 3},
    }]


def test_memory_bank_generates_only_typed_eligible_facts_in_the_same_scope():
    api = _MemoryApi()
    bank = VertexMemoryBank(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(api),
    )
    scope = MemoryScope(workspace_id="workspace-1", brand_id="brand-a")

    bank.generate(scope=scope, candidates=[
        MemoryCandidate(kind="operator_decision", fact="Operator approved one publish action.", evidence_ref=MemoryEvidenceRef(workspace_id="workspace-1", brand_id="brand-a", job_id="job-1", kind="decision", record_id="a1")),
        MemoryCandidate(kind="verified_outcome", fact="One published post was independently verified.", evidence_ref=MemoryEvidenceRef(workspace_id="workspace-1", brand_id="brand-a", job_id="job-1", kind="verification", record_id="a1")),
    ])

    assert api.generate_calls == [{
        "name": "projects/p/locations/us-central1/reasoningEngines/42",
        "scope": {"workspace_id": "workspace-1", "brand_id": "brand-a"},
        "direct_memories_source": {"direct_memories": [
            {"fact": '{"evidence_ref":{"brand_id":"brand-a","job_id":"job-1","kind":"decision","record_id":"a1","workspace_id":"workspace-1"},"fact":"Operator approved one publish action.","kind":"operator_decision"}'},
            {"fact": '{"evidence_ref":{"brand_id":"brand-a","job_id":"job-1","kind":"verification","record_id":"a1","workspace_id":"workspace-1"},"fact":"One published post was independently verified.","kind":"verified_outcome"}'},
        ]},
    }]


def test_memory_bank_rejects_malformed_results_instead_of_hiding_them():
    bank = VertexMemoryBank(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(_MemoryApi(results=[{"distance": 0.1}])),
    )
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
    bank = VertexMemoryBank(
        resource_name="projects/p/locations/us-central1/reasoningEngines/42",
        client=_Client(_MemoryApi()),
    )
    with pytest.raises(MemoryProtocolError, match="scope"):
        bank.generate(scope=MemoryScope(workspace_id="workspace-1", brand_id="brand-a"), candidates=[
            MemoryCandidate(kind="preference", fact="Use concise hooks.", evidence_ref=MemoryEvidenceRef(workspace_id="workspace-2", brand_id="brand-a", job_id="job-1", kind="decision", record_id="a1")),
        ])
