"""Lease-protected, model-free-by-default hourly Heartbeat orchestration."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any


async def _sync_arm(operation: Callable[[], Any]) -> Any:
    return await asyncio.to_thread(operation)


async def run_heartbeat(
    *,
    scheduled_at: str,
    claim_cycle: Callable[[str, str, int], dict[str, Any]],
    finalize_cycle: Callable[[dict[str, Any]], Any],
    stage_outbox: Callable[[int], list[dict[str, Any]]],
    recover_missed: Callable[[], list[dict[str, Any]]],
    inspect_stuck: Callable[[], list[dict[str, Any]]],
    provider_health: Callable[[], dict[str, Any]],
    budget_health: Callable[[], dict[str, Any]],
    maintenance: Callable[[], Any],
    cognitive_arm: Callable[[], Awaitable[Any]] | None = None,
    cognitive_due: bool = False,
) -> dict[str, Any]:
    """Run independent cheap arms; invoke cognition only when due and budgeted."""

    claim = await asyncio.to_thread(claim_cycle, "heartbeat", scheduled_at, 300)
    cycle_id = str(claim.get("cycleId", ""))
    if claim.get("outcome") != "execute":
        return {"status": str(claim.get("outcome", "uncertain")), "cycleId": cycle_id, "arms": {}}

    arms: dict[str, dict[str, Any]] = {}

    async def isolated(name: str, operation: Callable[[], Awaitable[Any]], summarize: Callable[[Any], dict[str, Any]]) -> None:
        try:
            arms[name] = {"status": "completed", **summarize(await operation())}
        except Exception as exc:  # noqa: BLE001 - one arm must not block unrelated work
            arms[name] = {"status": "failed", "failureType": type(exc).__name__}

    await isolated("stage_outbox", lambda: _sync_arm(lambda: stage_outbox(20)), lambda rows: {"publishedCount": sum(row.get("outcome") == "published" for row in rows)})
    await isolated("missed_cycles", lambda: _sync_arm(recover_missed), lambda rows: {"recoveredCount": len(rows)})
    await isolated("stuck_work", lambda: _sync_arm(inspect_stuck), lambda rows: {"attentionCount": len(rows)})
    await isolated("provider_health", lambda: _sync_arm(provider_health), lambda value: {"result": value})

    budget: dict[str, Any] = {"available": False, "reason": "budget health unavailable"}
    try:
        budget = await _sync_arm(budget_health)
        arms["budget_health"] = {"status": "completed", "available": bool(budget.get("available"))}
    except Exception as exc:  # noqa: BLE001
        arms["budget_health"] = {"status": "failed", "failureType": type(exc).__name__}

    await isolated("maintenance", lambda: _sync_arm(maintenance), lambda _value: {})
    if not cognitive_due:
        arms["cognitive"] = {"status": "deferred", "reason": "not_due"}
    elif not budget.get("available"):
        arms["cognitive"] = {"status": "paused", "reason": str(budget.get("reason", "autonomy budget unavailable"))}
    elif cognitive_arm is None:
        arms["cognitive"] = {"status": "failed", "failureType": "MissingCognitiveArm"}
    else:
        await isolated("cognitive", cognitive_arm, lambda _value: {})

    status = "partially_completed" if any(arm["status"] == "failed" for arm in arms.values()) else "completed"
    result = {"status": status, "cycleId": cycle_id, "arms": arms}
    await asyncio.to_thread(finalize_cycle, {"cycleId": cycle_id, "claimToken": claim.get("claimToken"), "scheduledAt": scheduled_at, **result})
    return result
