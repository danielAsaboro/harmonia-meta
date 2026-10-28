"""One externally triggered, lease-protected pass over durable autonomous work."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from typing import Any

from .tenant_context import tenant_scope


async def run_durable_tick(
    workspaces: list[dict[str, str]],
    claim_id: str,
    *,
    claim: Callable[[str, str, int], bool],
    scheduled: Callable[[], Awaitable[None]],
    proactive: Callable[[], Awaitable[list[dict[str, Any]]]],
    retention: Callable[[int], list[str]],
    stage_outbox: Callable[[int], list[dict[str, Any]]],
    production_outbox: Callable[[int], list[dict[str, Any]]],
    recovery: Callable[[], list[dict[str, Any]]],
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for workspace in workspaces:
        workspace_id = workspace["workspaceId"]
        brand_id = workspace["brandId"]
        with tenant_scope(workspace_id, brand_id):
            if not await asyncio.to_thread(claim, "durable-autonomy", claim_id, 55):
                results.append({"workspaceId": workspace_id, "status": "already_claimed"})
                continue
            arms: dict[str, Any] = {}
            try:
                dispatched = await asyncio.to_thread(stage_outbox, 20)
                arms["stage_outbox"] = {
                    "status": "ok",
                    "publishedCount": sum(item.get("outcome") == "published" for item in dispatched),
                }
            except Exception as exc:  # noqa: BLE001 - arms are isolated by design
                arms["stage_outbox"] = {"status": "failed", "errorType": type(exc).__name__}
            try:
                dispatched = await asyncio.to_thread(production_outbox, 20)
                arms["production_outbox"] = {
                    "status": "ok",
                    "publishedCount": sum(item.get("outcome") == "published" for item in dispatched),
                }
            except Exception as exc:  # noqa: BLE001 - arms are isolated by design
                arms["production_outbox"] = {"status": "failed", "errorType": type(exc).__name__}
            try:
                recovered = await asyncio.to_thread(recovery)
                arms["recovery"] = {"status": "ok", "actionCount": len(recovered)}
            except Exception as exc:  # noqa: BLE001
                arms["recovery"] = {"status": "failed", "errorType": type(exc).__name__}
            for name, operation in (
                ("scheduled", scheduled),
                ("proactive", proactive),
            ):
                try:
                    arms[name] = {"status": "ok", "result": await operation()}
                except Exception as exc:  # noqa: BLE001 - arms are isolated by design
                    arms[name] = {"status": "failed", "errorType": type(exc).__name__}
            try:
                erased = await asyncio.to_thread(retention, 20)
                arms["retention"] = {"status": "ok", "erasedCount": len(erased)}
            except Exception as exc:  # noqa: BLE001
                arms["retention"] = {"status": "failed", "errorType": type(exc).__name__}
            results.append({"workspaceId": workspace_id, "status": "ran", "arms": arms})
    return results
