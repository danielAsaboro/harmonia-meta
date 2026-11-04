"""Muse Spark watches the delivered clip blind and scores it.

The critic sees only the rendered file, the moment's title, and the faults
ffmpeg measured on it. It never sees the edit window, the source, or the plan,
so it judges the clip a viewer gets, not the intention behind it. Its score
and timed issues are advice recorded beside the measured gate: they never
override a measured fault, never approve anything, and a failed call leaves
the clip and its receipt untouched.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable

import httpx

from . import meta_api
from .model_catalog import PRICING_VERSION, estimate_text_cost
from .telemetry import current_trace_id
from .usage import InvocationContext, UsageRecord
from .video_understanding import _output_text, video_model
from .web_client import report_usage, reserve_budget, resolve_budget_reservation

logger = logging.getLogger("harmonia.clip_critic")

MAX_OUTPUT_TOKENS = 3000
MAX_ISSUES = 6
ESTIMATED_INPUT_TOKENS = 12_000
CRITERIA = ("hook", "pacing", "framing", "captions", "audio", "ending")

CRITIQUE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "score": {"type": "integer"},
        "issues": {
            "type": "array",
            "maxItems": MAX_ISSUES,
            "items": {
                "type": "object",
                "additionalProperties": False,
                "properties": {
                    "tSec": {"type": "number"},
                    "criterion": {"type": "string", "enum": list(CRITERIA)},
                    "severity": {"type": "string", "enum": ["major", "minor"]},
                    "note": {"type": "string"},
                },
                "required": ["tSec", "criterion", "severity", "note"],
            },
        },
    },
    "required": ["score", "issues"],
}

RUBRIC = (
    "You are reviewing a short social video clip exactly as a viewer would see it. Score it from 0 to 100 "
    "for a vertical social feed: does the first two seconds hook, is the pacing tight, is the speaker well "
    "framed, are captions readable and not covering the face, is the audio clean at the cut points, and does "
    "it end on a complete thought. List up to six concrete issues, each with the second it happens. Report "
    "only what is visible or audible in this clip."
)


def _critique(
    client: httpx.Client, model: str, video: bytes, prompt: str, before_dispatch: Callable[[int | None], None],
) -> tuple[str, dict[str, Any]]:
    with meta_api.video_input(client, video) as video_part:
        request = {
            "model": model,
            "reasoning": {"effort": "low"},
            "max_output_tokens": MAX_OUTPUT_TOKENS,
            "input": [{"type": "message", "role": "user", "content": [{"type": "input_text", "text": prompt}, video_part]}],
            "text": {"format": {"type": "json_schema", "name": "ClipCritique", "schema": CRITIQUE_SCHEMA, "strict": True}},
        }
        before_dispatch(meta_api.count_input_tokens(client, request))
        response = client.post("/responses", json=request)
    if response.status_code >= 300:
        raise RuntimeError(f"clip critique failed ({response.status_code})")
    body = response.json()
    return _output_text(body), dict(body.get("usage") or {})


def parse_critique(text: str, duration_sec: float) -> dict[str, Any]:
    raw = json.loads(text)
    issues = [
        {"tSec": round(min(max(float(item["tSec"]), 0.0), duration_sec), 1), "criterion": item["criterion"],
         "severity": item["severity"], "note": str(item["note"]).strip()[:240]}
        for item in raw.get("issues") or []
        if isinstance(item, dict) and item.get("criterion") in CRITERIA and item.get("severity") in ("major", "minor")
        and str(item.get("note") or "").strip()
    ][:MAX_ISSUES]
    return {"score": max(0, min(100, int(raw["score"]))), "issues": issues}


def critique_clip(
    clip: Path,
    *,
    title: str,
    measured: dict[str, Any],
    invocation: InvocationContext,
    critique: Callable[..., tuple[str, dict[str, Any]]] = _critique,
    client_factory: Callable[[float], httpx.Client] = lambda timeout: meta_api.client(timeout, purpose="Muse Spark clip review"),
    budget_reserver: Callable[[dict[str, object]], None] = reserve_budget,
    budget_resolver: Callable[[dict[str, object]], None] = resolve_budget_reservation,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> dict[str, Any] | None:
    """A blind score and timed issues for ``clip``, or None when the critic is unavailable."""
    role = "clip_critic"
    model = video_model()
    operation_id = invocation.role_operation_id(role)
    faults = ", ".join(f"{fault['code']} at {fault['startSec']}–{fault['endSec']} s" for fault in measured.get("faults") or []) or "none"
    prompt = f"{RUBRIC}\nClip title: {title[:200]}\nFaults already measured by ffmpeg: {faults}."
    progress: dict[str, Any] = {"state": "pending", "input": ESTIMATED_INPUT_TOKENS}

    def reserve(counted: int | None) -> None:
        if counted is not None:
            progress["input"] = counted
        budget_reserver({
            "jobId": invocation.job_id, "operationId": operation_id, "stage": invocation.stage, "role": role, "model": model,
            "estimatedCostUsd": str(estimate_text_cost(model, progress["input"], MAX_OUTPUT_TOKENS)), "pricingVersion": PRICING_VERSION,
        })
        progress["state"] = "dispatched"

    try:
        with client_factory(300.0) as client:
            text, usage = critique(client, model, clip.read_bytes(), prompt, reserve)
        input_tokens = int(usage.get("input_tokens") or progress["input"])
        output_tokens = int(usage.get("output_tokens") or 0)
        cached = min(int((usage.get("input_tokens_details") or {}).get("cached_tokens") or 0), input_tokens)
        usage_reporter(UsageRecord(
            id=f"usage-{sha256(operation_id.encode()).hexdigest()[:24]}", job_id=invocation.job_id, operation_id=operation_id,
            stage=invocation.stage, role=role, model=model, input_units=input_tokens, output_units=output_tokens,
            cached_input_units=cached or None, unit_type="tokens",
            estimated_cost_usd=str(estimate_text_cost(model, input_tokens, output_tokens, cached)),
            trace_id=current_trace_id(), created_at=datetime.now(timezone.utc).isoformat(),
        ).to_wire())
        progress["state"] = "reported"
        return {"model": model, **parse_critique(text, float(measured.get("durationSec") or 0) or 600.0)}
    except Exception as exc:  # noqa: BLE001 - the critic is advice; the clip ships without it
        logger.warning("clip critique unavailable: %s", type(exc).__name__)
        if progress["state"] == "dispatched":
            try:
                budget_resolver({"jobId": invocation.job_id, "operationId": operation_id, "outcome": "uncertain",
                                 "reason": "clip critique failed after provider dispatch"})
            except Exception:  # noqa: BLE001
                logger.exception("budget resolution failed for operation %s", operation_id)
        return None
