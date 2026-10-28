"""Bounded client for deterministic durable-state recovery."""

from __future__ import annotations

from collections.abc import Callable
from typing import Any


def recover_missed(
    *,
    limit: int = 20,
    deadline_seconds: int = 15,
    max_retries: int = 3,
    max_cost_usd: str = "0.250000",
    submit: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    if not 1 <= limit <= 100:
        raise ValueError("recovery limit must be between 1 and 100")
    if not 1 <= deadline_seconds <= 60:
        raise ValueError("recovery deadline must be between 1 and 60 seconds")
    if not 0 <= max_retries <= 20:
        raise ValueError("recovery max retries must be between 0 and 20")
    if submit is None:
        from .web_client import run_recovery
        submit = run_recovery
    result = submit({
        "limit": limit,
        "deadlineSeconds": deadline_seconds,
        "maxRetries": max_retries,
        "maxCostUsd": max_cost_usd,
    })
    return list(result.get("actions") or [])
