import asyncio

from harmonia_agent.heartbeat import run_heartbeat


def test_heartbeat_runs_deterministic_arms_without_model_calls():
    model_calls = []

    async def model_arm():
        model_calls.append(True)

    result = asyncio.run(run_heartbeat(
        scheduled_at="2026-08-27T08:00:00Z",
        claim_cycle=lambda *_args: {"outcome": "execute", "cycleId": "cycle-1"},
        finalize_cycle=lambda payload: payload,
        stage_outbox=lambda limit: [{"outcome": "published"}],
        recover_missed=lambda: [{"cycleId": "missed-1"}],
        inspect_stuck=lambda: [{"jobId": "job-1", "reason": "expired lease"}],
        provider_health=lambda: {"gemini": "healthy"},
        budget_health=lambda: {"available": True},
        maintenance=lambda: ["retention-complete"],
        cognitive_arm=model_arm,
        cognitive_due=False,
    ))

    assert result["status"] == "completed"
    assert result["arms"]["stage_outbox"]["publishedCount"] == 1
    assert result["arms"]["stuck_work"]["attentionCount"] == 1
    assert result["arms"]["cognitive"] == {"status": "deferred", "reason": "not_due"}
    assert model_calls == []


def test_heartbeat_isolates_failed_arms_and_pauses_paid_work_when_budget_is_empty():
    entered = []

    def broken_outbox(_limit):
        raise RuntimeError("pubsub unavailable")

    async def cognitive():
        entered.append("cognitive")

    result = asyncio.run(run_heartbeat(
        scheduled_at="2026-08-27T08:00:00Z",
        claim_cycle=lambda *_args: {"outcome": "execute", "cycleId": "cycle-1"},
        finalize_cycle=lambda payload: payload,
        stage_outbox=broken_outbox,
        recover_missed=lambda: [], inspect_stuck=lambda: [], provider_health=lambda: {"gemini": "unknown"},
        budget_health=lambda: {"available": False, "reason": "daily budget exhausted"},
        maintenance=lambda: entered.append("maintenance") or [], cognitive_arm=cognitive, cognitive_due=True,
    ))

    assert result["status"] == "partially_completed"
    assert result["arms"]["stage_outbox"] == {"status": "failed", "failureType": "RuntimeError"}
    assert result["arms"]["maintenance"]["status"] == "completed"
    assert result["arms"]["cognitive"] == {"status": "paused", "reason": "daily budget exhausted"}
    assert entered == ["maintenance"]


def test_duplicate_heartbeat_never_enters_an_arm():
    entered = []
    result = asyncio.run(run_heartbeat(
        scheduled_at="2026-08-27T08:00:00Z",
        claim_cycle=lambda *_args: {"outcome": "in_progress", "cycleId": "cycle-1"},
        finalize_cycle=lambda payload: entered.append(payload),
        stage_outbox=lambda _limit: entered.append("outbox"), recover_missed=lambda: entered.append("missed"),
        inspect_stuck=lambda: entered.append("stuck"), provider_health=lambda: entered.append("provider"),
        budget_health=lambda: entered.append("budget"), maintenance=lambda: entered.append("maintenance"),
    ))
    assert result == {"status": "in_progress", "cycleId": "cycle-1", "arms": {}}
    assert entered == []
