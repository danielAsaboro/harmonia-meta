"""FastAPI entrypoint: Pub/Sub push receiver plus health endpoint.

On Cloud Run the stage topic uses a push subscription with an OIDC service
account; invocation is authenticated by Cloud Run IAM, so the handler trusts
the platform. Locally (PUBSUB_EMULATOR_HOST set) a pull loop consumes the
same topic so development exercises the identical dispatch path."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
import secrets
import threading
from typing import Any

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from opentelemetry import context as otel_context

from .config import settings
from .a2ui_api import router as a2ui_router
from .ask_api import router as ask_router
from .intent_api import router as intent_router
from .extraction_api import router as extraction_router
from .stages import HANDLERS, dispatch
from .telemetry import configure_telemetry, extract_context
from .tenant_context import tenant_scope
from .durable_tick import run_durable_tick
from .operation_context import operation_scope
from .production_executor import execute_production_operation
from .web_client import WebApiError, claim_event_inbox, claim_operation, complete_event_inbox

configure_telemetry()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("harmonia.worker")

app = FastAPI(title="harmonia-agent", version="1.0.0")
app.include_router(a2ui_router)
app.include_router(ask_router)
app.include_router(intent_router)
app.include_router(extraction_router)

if settings().telemetry_enabled:
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from opentelemetry.instrumentation.httpx import HTTPXClientInstrumentor

    FastAPIInstrumentor.instrument_app(app)
    HTTPXClientInstrumentor().instrument()


@app.get("/healthz")
async def healthz() -> dict[str, Any]:
    config = settings()
    return {
        "ok": True,
        "service": "harmonia-agent",
        "project": config.gcp_project,
        "model": config.model_id,
        "stages": sorted(HANDLERS.keys()),
        "durableRuntime": {
            "protocolVersion": 1,
            "stateStore": "firestore",
            "wakeTransport": "pubsub",
            "contextCompiler": "harmonia-context/v1",
            "recovery": {
                "limit": config.durable_recovery_limit,
                "deadlineSeconds": config.durable_recovery_deadline_seconds,
                "maxRetries": config.durable_recovery_max_retries,
            },
        },
    }


@app.post("/durable/recover")
async def durable_recover() -> dict[str, Any]:
    """OIDC/IAM-protected, model-free recovery wake with deployment bounds."""
    from .recovery import recover_missed
    from .web_client import get_workspaces

    config = settings()
    results = []
    action_count = 0
    for scope in await asyncio.to_thread(get_workspaces):
        with tenant_scope(scope["workspaceId"], scope["brandId"]):
            actions = await asyncio.to_thread(
                recover_missed,
                limit=config.durable_recovery_limit,
                deadline_seconds=config.durable_recovery_deadline_seconds,
                max_retries=config.durable_recovery_max_retries,
                max_cost_usd=config.durable_recovery_max_cost_usd,
            )
        action_count += len(actions)
        results.append({
            "workspaceId": scope["workspaceId"],
            "actionCount": len(actions),
            "actions": actions,
        })
    return {"ok": True, "workspaces": results, "actionCount": action_count}


@app.post("/durable/tick")
async def durable_tick() -> dict[str, Any]:
    from datetime import datetime, timezone
    from . import proactive, scheduler
    from .recovery import recover_missed
    from .web_client import (
        claim_tick,
        get_workspaces,
        run_production_outbox_tick,
        run_retention_tick,
        run_stage_outbox_tick,
    )

    workspaces = await asyncio.to_thread(get_workspaces)
    claim_id = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%MZ")
    return {
        "ok": True,
        "claimId": claim_id,
        "workspaces": await run_durable_tick(
            workspaces,
            claim_id,
            claim=claim_tick,
            scheduled=scheduler.tick_current_tenant,
            proactive=proactive.tick,
            retention=run_retention_tick,
            stage_outbox=run_stage_outbox_tick,
            production_outbox=run_production_outbox_tick,
            recovery=recover_missed,
        ),
    }


def _valid_production_wake(body: Any) -> dict[str, Any] | None:
    if not isinstance(body, dict):
        return None
    required = ("workspaceId", "brandId", "planId", "operationId")
    if any(not isinstance(body.get(key), str) or not body[key] for key in required):
        return None
    if any(len(body[key]) > 256 for key in required):
        return None
    if not isinstance(body.get("internalRun"), int) or body["internalRun"] < 0:
        return None
    if not isinstance(body.get("planRevision"), int) or body["planRevision"] < 1:
        return None
    plan_digest = body.get("planDigest")
    if not isinstance(plan_digest, str) or len(plan_digest) != 64 or any(char not in "0123456789abcdef" for char in plan_digest):
        return None
    return {
        **{key: body[key] for key in required},
        "planRevision": body["planRevision"], "planDigest": plan_digest,
        "internalRun": body["internalRun"],
    }


async def _run_production_wake(body: dict[str, Any]) -> dict[str, Any]:
    with tenant_scope(body["workspaceId"], body["brandId"]):
        return await asyncio.to_thread(
            execute_production_operation,
            body["planId"],
            body["operationId"],
            plan_revision=body["planRevision"],
            plan_digest=body["planDigest"],
            internal_run=body["internalRun"],
        )


@app.post("/production/execute")
async def production_execute(request: Request) -> JSONResponse:
    """IAM-protected direct wake for one exact sealed production operation."""
    try:
        body = _valid_production_wake(await request.json())
    except Exception:  # noqa: BLE001 - malformed wake is a bounded client error
        body = None
    if body is None:
        return JSONResponse({"error": "invalid production operation wake"}, status_code=400)
    return JSONResponse(await _run_production_wake(body))


@app.post("/pubsub/production")
async def production_pubsub_push(request: Request) -> JSONResponse:
    """OIDC-authenticated Pub/Sub wake; the durable operation claim is the dedupe fence."""
    try:
        envelope = await request.json()
        message = envelope["message"]
        body = _valid_production_wake(json.loads(base64.b64decode(message["data"])))
        attributes = message.get("attributes") or {}
        expected_attributes = {
            "workspaceId": body["workspaceId"] if body else None,
            "brandId": body["brandId"] if body else None,
            "planId": body["planId"] if body else None,
            "planRevision": str(body["planRevision"]) if body else None,
            "planDigest": body["planDigest"] if body else None,
            "operationId": body["operationId"] if body else None,
            "internalRun": str(body["internalRun"]) if body else None,
        }
        if body is None or any(attributes.get(key) != value for key, value in expected_attributes.items()):
            raise ValueError("production wake scope mismatch")
    except Exception as exc:  # noqa: BLE001 - poison message must not redeliver forever
        logger.error("malformed production push envelope: %s", exc)
        return JSONResponse({"ack": True, "error": "malformed production envelope"})
    try:
        result = await _run_production_wake(body)
    except WebApiError as exc:
        if exc.permanent:
            logger.warning("production operation wake permanently rejected: %s", exc)
            return JSONResponse({"ack": True, "permanent": True, "error": "production operation rejected"})
        logger.exception("production operation execution failed")
        return JSONResponse({"ack": False, "retryable": True}, status_code=503)
    except Exception:  # noqa: BLE001 - transient/uncertain state is durably fenced by the claim
        logger.exception("production operation execution failed")
        return JSONResponse({"ack": False, "retryable": True}, status_code=503)
    return JSONResponse({"ack": True, **result})


@app.post("/durable/heartbeat")
async def resident_heartbeat() -> dict[str, Any]:
    """OIDC/IAM-protected hourly wake; the controller itself is model-free by default."""
    from datetime import datetime, timezone
    from .heartbeat import run_heartbeat
    from .web_client import claim_autonomy_cycle, finalize_autonomy_cycle, get_feed, get_workspaces, run_retention_tick, run_stage_outbox_tick
    from .recovery import recover_missed
    from .tenant_context import tenant_scope
    scheduled_at = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0).isoformat()
    results = []
    for scope in await asyncio.to_thread(get_workspaces):
        with tenant_scope(scope["workspaceId"], scope["brandId"]):
            feed = await asyncio.to_thread(get_feed)
            result = await run_heartbeat(scheduled_at=scheduled_at, claim_cycle=claim_autonomy_cycle, finalize_cycle=finalize_autonomy_cycle, stage_outbox=run_stage_outbox_tick, recover_missed=recover_missed, inspect_stuck=lambda: list(feed.get("failedJobs") or []), provider_health=lambda: {"status": "configured"}, budget_health=lambda: {"available": False, "reason": "no cognitive arm due"}, maintenance=lambda: run_retention_tick(20))
            results.append({"workspaceId": scope["workspaceId"], **result})
    return {"ok": True, "scheduledAt": scheduled_at, "workspaces": results}


@app.post("/durable/dream")
async def resident_dream() -> dict[str, Any]:
    """Authenticated nightly wake. Persistence/model adapters remain fail-closed until eligible evidence exists."""
    from datetime import datetime, timezone
    return {"ok": True, "status": "deferred", "reason": "eligible observation feed not yet materialized for this wake", "scheduledAt": datetime.now(timezone.utc).isoformat()}


@app.post("/durable/wakeup")
async def resident_wakeup() -> dict[str, Any]:
    """Authenticated morning wake; never invents a briefing without persisted Dream results."""
    from datetime import datetime, timezone
    return {"ok": True, "status": "deferred", "reason": "no persisted Dream result available", "scheduledAt": datetime.now(timezone.utc).isoformat()}


class PushEnvelope(dict):
    pass


def _stage_delivery(
    data: dict[str, Any], carrier: dict[str, str]
) -> tuple[str, str, str, str, int]:
    if int(data.get("schemaVersion", 0)) != 1:
        raise ValueError("unsupported stage event schema")
    if str(data.get("source")) != "stage_outbox":
        raise ValueError("unsupported stage event source")
    if str(data.get("eventType")) != "stage.requested":
        raise ValueError("unsupported stage event type")
    workspace_id = str(data["workspaceId"])
    brand_id = str(data["brandId"])
    job_id = str(data["jobId"])
    operation_id = str(data["operationId"])
    source_event_id = str(data["sourceEventId"])
    payload = data.get("payload")
    if not isinstance(payload, dict):
        raise ValueError("stage event payload is missing")
    stage = str(payload["stage"])
    attempt = int(data.get("attempt", 0))
    if attempt < 0:
        raise ValueError("stage event attempt is invalid")
    expected = {
        "workspaceId": workspace_id,
        "brandId": brand_id,
        "sourceEventId": source_event_id,
        "operationId": operation_id,
    }
    if any(carrier.get(key) != value for key, value in expected.items()):
        raise ValueError("stage event attributes do not match payload")
    return workspace_id, brand_id, job_id, stage, attempt


async def _process_stage_event(
    data: dict[str, Any],
    carrier: dict[str, str],
    message_id: str,
    delivery_attempt: int,
) -> tuple[bool, dict[str, Any]]:
    workspace_id, brand_id, job_id, stage, source_attempt = _stage_delivery(data, carrier)
    # Pub/Sub delivery attempts are transport retries, not cognitive-stage
    # generations. Advancing the stage retry budget on redelivery can turn a
    # recoverable provider interruption into a false terminal failure.
    attempt = source_attempt
    operation_id = str(data["operationId"])
    event_token = secrets.token_urlsafe(32)
    with tenant_scope(workspace_id, brand_id):
        event_claim = await asyncio.to_thread(claim_event_inbox, {
            "envelope": data,
            "pubsubMessageId": message_id,
            "claimToken": event_token,
        })
        if event_claim["outcome"] != "execute":
            return True, {
                "ack": True,
                "retryable": False,
                "duplicate": True,
                "eventOutcome": event_claim["outcome"],
                "attempt": attempt,
            }

        operation_token = secrets.token_urlsafe(32)
        operation_claim = await asyncio.to_thread(claim_operation, {
            "operationId": operation_id,
            "ownerId": f"worker:{os.getpid()}",
            "claimToken": operation_token,
        })
        if operation_claim["outcome"] != "execute":
            return True, {
                "ack": True,
                "retryable": False,
                "duplicate": True,
                "operationOutcome": operation_claim["outcome"],
                "attempt": attempt,
            }

        epoch = int(operation_claim["operation"]["epoch"])
        goal_digest = str((operation_claim["operation"].get("goal") or {}).get("digest") or "")
        with operation_scope(operation_id, epoch, goal_digest=goal_digest or None):
            acknowledge = await dispatch(job_id, stage, attempt=attempt, operation_id=operation_id)
            if not acknowledge:
                return False, {"ack": False, "retryable": True, "attempt": attempt}
            failed = acknowledge == "failed"
            await asyncio.to_thread(complete_event_inbox, {
                "source": str(data["source"]),
                "sourceEventId": str(data["sourceEventId"]),
                "claimToken": event_token,
                "outcome": "rejected" if failed else "completed",
                **({"rejectionReason": "stage handler failed"} if failed else {}),
                "operationEpoch": epoch,
                "operationState": "failed" if failed else "succeeded",
            })
        return True, {"ack": True, "retryable": False, "attempt": attempt, **({"failed": True} if failed else {})}


@app.post("/pubsub/push")
async def pubsub_push(request: Request) -> JSONResponse:
    envelope = await request.json()
    try:
        message = envelope["message"]
        data = json.loads(base64.b64decode(message["data"]))
        delivery_attempt = max(int(envelope.get("deliveryAttempt", 1)) - 1, 0)
        carrier = {str(k): str(v) for k, v in (message.get("attributes") or {}).items()}
        _stage_delivery(data, carrier)
        message_id = str(message["messageId"])
    except Exception as exc:  # noqa: BLE001 - malformed delivery: ack to stop poison redelivery
        logger.error("malformed push envelope: %s", exc)
        return JSONResponse({"ack": True, "error": "malformed envelope"})

    token = otel_context.attach(extract_context(carrier))
    try:
        try:
            acknowledge, result = await _process_stage_event(
                data, carrier, message_id, delivery_attempt
            )
        except Exception:  # noqa: BLE001 - leave durable claims for bounded recovery
            logger.exception("durable stage event processing failed")
            return JSONResponse({"ack": False, "retryable": True}, status_code=503)
    finally:
        otel_context.detach(token)
    if not acknowledge:
        return JSONResponse(result, status_code=503)
    return JSONResponse(result)


def _pubsub_project() -> str:
    return os.environ.get("PUBSUB_EMULATOR_PROJECT", settings().gcp_project)


def _run_pull_loop() -> None:
    from google.cloud import pubsub_v1

    # Local Pub/Sub may intentionally use an emulator namespace while Gemini
    # authenticates against the real Vertex AI project.
    project = _pubsub_project()
    topic_name = os.environ.get("PUBSUB_STAGE_TOPIC", "harmonia-stages")
    subscriber = pubsub_v1.SubscriberClient()
    subscription_path = subscriber.subscription_path(project, f"{topic_name}-local-pull")

    def ensure_subscription() -> None:
        from google.cloud import pubsub_v1 as ps

        publisher = ps.PublisherClient()
        topic_path = publisher.topic_path(project, topic_name)
        try:
            publisher.create_topic(name=topic_path)
        except Exception:  # noqa: BLE001 - already exists
            pass
        try:
            subscriber.create_subscription(
                name=subscription_path, topic=topic_path, ack_deadline_seconds=120
            )
        except Exception:  # noqa: BLE001 - already exists
            pass

    ensure_subscription()
    logger.info("local pull loop started on %s", subscription_path)

    while True:
        response = subscriber.pull(subscription=subscription_path, max_messages=1, timeout=15)
        if not response.received_messages:
            continue
        for msg in response.received_messages:
            try:
                data = json.loads(msg.message.data.decode("utf-8"))
                delivery_attempt = max(int(getattr(msg, "delivery_attempt", 1) or 1) - 1, 0)
                carrier = {str(k): str(v) for k, v in msg.message.attributes.items()}
                _stage_delivery(data, carrier)
                token = otel_context.attach(extract_context(carrier))
                try:
                    acknowledge, _result = asyncio.run(_process_stage_event(
                        data,
                        carrier,
                        str(msg.message.message_id),
                        delivery_attempt,
                    ))
                finally:
                    otel_context.detach(token)
                if acknowledge:
                    subscriber.acknowledge(subscription=subscription_path, ack_ids=[msg.ack_id])
                else:
                    subscriber.modify_ack_deadline(
                        subscription=subscription_path, ack_ids=[msg.ack_id], ack_deadline_seconds=0
                    )
                    logger.warning("transient failure; nacked for redelivery")
            except Exception:  # noqa: BLE001 - keep looping
                logger.exception("pull processing error")
                subscriber.acknowledge(subscription=subscription_path, ack_ids=[msg.ack_id])


def _run_production_pull_loop() -> None:
    from google.cloud import pubsub_v1

    project = settings().gcp_project
    topic_name = os.environ.get("PUBSUB_PRODUCTION_TOPIC", "harmonia-production")
    subscriber = pubsub_v1.SubscriberClient()
    subscription_path = subscriber.subscription_path(project, f"{topic_name}-local-pull")
    publisher = pubsub_v1.PublisherClient()
    topic_path = publisher.topic_path(project, topic_name)
    try:
        publisher.create_topic(name=topic_path)
    except Exception:  # noqa: BLE001 - already exists
        pass
    try:
        subscriber.create_subscription(
            name=subscription_path, topic=topic_path, ack_deadline_seconds=300
        )
    except Exception:  # noqa: BLE001 - already exists
        pass
    logger.info("local production pull loop started on %s", subscription_path)

    while True:
        response = subscriber.pull(subscription=subscription_path, max_messages=1, timeout=15)
        if not response.received_messages:
            continue
        for msg in response.received_messages:
            try:
                body = _valid_production_wake(json.loads(msg.message.data.decode("utf-8")))
                attributes = msg.message.attributes
                if body is None or any(
                    attributes.get(key) != body[key] for key in ("workspaceId", "brandId")
                ):
                    raise ValueError("production wake scope mismatch")
            except ValueError:
                logger.exception("malformed local production message")
                subscriber.acknowledge(subscription=subscription_path, ack_ids=[msg.ack_id])
            else:
                try:
                    asyncio.run(_run_production_wake(body))
                except Exception:  # noqa: BLE001 - retry behind the durable claim fence
                    logger.exception("local production processing failed")
                    subscriber.modify_ack_deadline(
                        subscription=subscription_path, ack_ids=[msg.ack_id], ack_deadline_seconds=0
                    )
                else:
                    subscriber.acknowledge(subscription=subscription_path, ack_ids=[msg.ack_id])


def _start_pull_loop_if_emulator() -> None:
    if os.environ.get("PUBSUB_EMULATOR_HOST"):
        threading.Thread(target=_run_pull_loop, daemon=True).start()
        threading.Thread(target=_run_production_pull_loop, daemon=True).start()


_start_pull_loop_if_emulator()
