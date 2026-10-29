"""Deterministic morning briefing assembled from persisted nightly synthesis."""

from __future__ import annotations

from typing import Any


def assemble_wakeup_call(*, cycle_id: str, dream: dict[str, Any], operations: dict[str, Any]) -> dict[str, Any]:
    summary = str(dream.get("safeActivitySummary") or "No new nightly synthesis was recorded.")
    failed = [str(value) for value in operations.get("failedJobs") or []]
    approvals = [str(value) for value in operations.get("pendingApprovals") or []]
    items: list[dict[str, Any]] = []
    for experiment_id in dream.get("experimentIds") or []:
        items.append({"key": f"experiment:{experiment_id}", "title": "Review bounded experiment", "authority": "propose", "evidenceRefs": [str(experiment_id)]})
    for job_id in failed:
        items.append({"key": f"failed:{job_id}", "title": "Resolve failed job", "authority": "request_attention", "evidenceRefs": [job_id]})
    for action_id in approvals:
        items.append({"key": f"approval:{action_id}", "title": "Review pending approval", "authority": "request_attention", "evidenceRefs": [action_id]})
    health = f"Budget {'available' if operations.get('budgetAvailable') else 'unavailable'}; provider health {operations.get('providerHealth', 'unknown')}."
    return {"cycleId": cycle_id, "briefing": f"{summary} {health}", "items": items, "source": "persisted_dream_and_operational_state"}
