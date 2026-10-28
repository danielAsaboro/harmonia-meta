"""Scheduler dispatcher: wakes immutable effect commands when they come due.

Production calls ``tick_current_tenant`` from the OIDC Cloud Scheduler endpoint.
The optional development background loop asks the web service every 60s for
due/publishing items; auto-mode items publish immediately
(scheduling was the approval), and publishing items are retries of approved
final-review items. Outcomes report back through the internal API, which
records receipts-style state and fires notifications.

Only official platform APIs are used through the shared effect executor. A platform that
is not connected fails visibly — never silently skipped.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time

from .effect_executor import execute_effect_command, production_adapters
from .web_client import get_connection, get_due_effect_command_ids, get_effect_command, get_workspaces, run_library_sync_tick
from .tenant_context import tenant_scope

logger = logging.getLogger("harmonia.scheduler")

POLL_SECONDS = 60


async def _tenant_tick() -> None:
    await asyncio.to_thread(run_library_sync_tick)
    for command_id in get_due_effect_command_ids():
        try:
            command = get_effect_command(command_id)
            kind = str(command["actionType"])
            connection_kind = "x" if kind in {"publish_x_post", "publish_x_thread"} else "linkedin" if kind == "publish_linkedin_post" else None
            connection = get_connection(connection_kind) if connection_kind else {}
            result = execute_effect_command(command, adapters=production_adapters(
                x_access_token=str(connection.get("accessToken") or "") if connection_kind == "x" else "",
                linkedin_access_token=str(connection.get("accessToken") or "") if connection_kind == "linkedin" else "",
                job_id=str(command["jobId"]),
            ))
            if result.outcome in {"in_progress", "already_applied"}:
                logger.info("scheduled command %s: %s", command_id, result.outcome)
            elif result.outcome == "uncertain":
                logger.error("scheduled command %s has an uncertain prior outcome", command_id)
        except Exception as exc:  # noqa: BLE001 - failures must be visible, not crash the loop
            logger.error("scheduled command %s failed: %s: %s", command_id, type(exc).__name__, exc)


async def _tick() -> None:
    for workspace in get_workspaces():
        with tenant_scope(workspace["workspaceId"], workspace["brandId"]):
            await _tenant_tick()


async def tick_current_tenant() -> None:
    await _tenant_tick()


def _run_loop() -> None:
    logger.info("scheduler dispatcher started (every %ss)", POLL_SECONDS)
    while True:
        try:
            asyncio.run(_tick())
        except Exception:  # noqa: BLE001 - keep the loop alive
            logger.exception("scheduler tick failed")
        time.sleep(POLL_SECONDS)


def start_background() -> None:
    threading.Thread(target=_run_loop, daemon=True).start()


def main() -> None:
    logging.basicConfig(level=logging.INFO)
    _run_loop()
