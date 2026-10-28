"""One-way Telegram notification delivery through the official Bot API.

Interactive Telegram chat and approval traffic is handled by the authenticated
webhook surface. The worker intentionally has no polling or decision path.
"""

from __future__ import annotations

import logging

import httpx

from .web_client import get_telegram_connection

logger = logging.getLogger("harmonia.telegram")

TELEGRAM_API = "https://api.telegram.org"


def notify(text: str) -> bool:
    """Deliver a proactive notification to the configured Telegram chat."""
    connection = get_telegram_connection()
    if not connection:
        return False
    try:
        response = httpx.post(
            f"{TELEGRAM_API}/bot{connection['botToken']}/sendMessage",
            json={"chat_id": connection["chatId"], "text": text},
            timeout=40,
        )
        body = response.json()
        if not body.get("ok"):
            raise RuntimeError(
                f"telegram sendMessage failed: {body.get('description')}"
            )
        return True
    except Exception as exc:  # noqa: BLE001 - notification failure is non-fatal
        logger.warning("telegram notify failed: %s", exc)
        return False
