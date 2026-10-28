"""Independent, lease-claimed dispatch of durable morning agenda items."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from typing import Any


async def dispatch_agenda(
    items: list[dict[str, Any]], *, claim: Callable[[str], bool], execute: Callable[[dict[str, Any]], Any],
    auto_tune: Callable[[dict[str, Any]], Any], propose: Callable[[dict[str, Any]], Any],
    request_attention: Callable[[dict[str, Any]], Any], finalize: Callable[[str, dict[str, Any]], Any],
) -> list[dict[str, Any]]:
    handlers = {"execute": execute, "auto_tune": auto_tune, "propose": propose, "request_attention": request_attention}
    results: list[dict[str, Any]] = []
    for item in items:
        item_id = str(item["id"])
        if not await asyncio.to_thread(claim, item_id):
            results.append({"id": item_id, "status": "already_claimed"})
            continue
        try:
            handler = handlers[str(item["authority"])]
            await asyncio.to_thread(handler, item)
            outcome = {"id": item_id, "status": "completed"}
        except Exception as exc:  # noqa: BLE001 - agenda arms are isolated
            outcome = {"id": item_id, "status": "failed", "failureType": type(exc).__name__}
        await asyncio.to_thread(finalize, item_id, outcome)
        results.append(outcome)
    return results
