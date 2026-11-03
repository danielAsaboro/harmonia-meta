import asyncio

from harmonia_agent.durable_tick import run_durable_tick
from harmonia_agent.tenant_context import current_tenant


def test_tick_claims_each_workspace_and_isolates_failed_arms():
    calls = []

    def claim(key, claim_id, lease):
        calls.append((current_tenant().workspace_id, key, claim_id, lease))
        return True

    async def scheduled():
        raise RuntimeError("platform unavailable")

    async def proactive():
        return [{"check": "calendar", "summary": "ok"}]

    def retention(limit):
        assert limit == 20
        return []

    def stage_outbox(limit):
        assert limit == 20
        return [{"outcome": "published"}]

    def recovery():
        return [{"action": "replay_operation"}]

    result = asyncio.run(run_durable_tick(
        [{"workspaceId": "w1", "brandId": "b1"}], "2026-08-26T00:35Z",
        claim=claim, scheduled=scheduled, proactive=proactive, retention=retention,
        stage_outbox=stage_outbox, recovery=recovery,
    ))

    assert calls == [("w1", "durable-autonomy", "2026-08-26T00:35Z", 55)]
    assert result[0]["arms"]["scheduled"] == {"status": "failed", "errorType": "RuntimeError"}
    assert result[0]["arms"]["proactive"]["status"] == "ok"
    assert result[0]["arms"]["retention"]["status"] == "ok"
    assert result[0]["arms"]["stage_outbox"] == {"status": "ok", "publishedCount": 1}
    assert result[0]["arms"]["recovery"] == {"status": "ok", "actionCount": 1}


def test_duplicate_tick_does_not_enter_any_arm():
    entered = []

    async def operation():
        entered.append(True)
        return []

    result = asyncio.run(run_durable_tick(
        [{"workspaceId": "w1", "brandId": "b1"}], "same-minute",
        claim=lambda *_args: False,
        scheduled=operation, proactive=operation, retention=lambda _limit: entered.append(True) or [],
        stage_outbox=lambda _limit: entered.append(True) or [],
        recovery=lambda: entered.append(True) or [],
    ))

    assert result == [{"workspaceId": "w1", "status": "already_claimed"}]
    assert entered == []
