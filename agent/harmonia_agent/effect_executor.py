"""Single claim-before-effect executor for immediate and scheduled commands."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import uuid
from typing import Any, Callable, Mapping

from .telemetry import current_trace_id
from .operation_context import current_operation, operation_scope

@dataclass(frozen=True)
class EffectAdapterContext:
    progress: dict[str, Any] | None
    persist_progress: Callable[[dict[str, Any]], None]


Adapter = Callable[[dict[str, Any], EffectAdapterContext], dict[str, Any]]


@dataclass(frozen=True)
class ExecutionResult:
    outcome: str
    receipt_id: str | None = None


class ProviderEffectNotStarted(RuntimeError):
    """Adapter proof that control never entered the external provider."""


def x_publish_adapter(payload: dict[str, Any], bearer_token: str | None = None) -> dict[str, Any]:
    from . import x_client

    text = payload.get("text")
    if not isinstance(text, str) or not text:
        raise ValueError("X effect command has no text")
    posted = x_client.publish_post(text, bearer_token)
    return {
        "outcome": "applied",
        "artifact": {
            "kind": "x_api", "url": posted["url"],
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "digest": hashlib.sha256(text.encode()).hexdigest(),
        },
        "detail": dict(posted),
    }


def x_thread_publish_adapter(
    payload: dict[str, Any],
    bearer_token: str,
    *,
    context: EffectAdapterContext,
    publish=None,
) -> dict[str, Any]:
    from . import x_client

    posts = payload.get("posts")
    if not isinstance(posts, list):
        raise ValueError("X thread effect command requires ordered posts")
    progress = context.progress or {}
    if progress and progress.get("kind") != "x_thread":
        raise ValueError("X thread effect command has invalid durable progress")
    confirmed = list(progress.get("confirmedPostIds") or [])
    result = (publish or x_client.publish_thread)(
        posts,
        bearer_token,
        confirmed=confirmed,
        persist_confirmed=lambda ids: context.persist_progress({
            "kind": "x_thread", "confirmedPostIds": list(ids),
        }),
    )
    digest = hashlib.sha256(
        "\n".join(str(post.get("text") or "") for post in posts).encode()
    ).hexdigest()
    return {
        "outcome": "applied",
        "artifact": {
            "kind": "x_api", "url": result["url"],
            "fetchedAt": datetime.now(timezone.utc).isoformat(), "digest": digest,
        },
        "detail": dict(result),
    }


def linkedin_publish_adapter(payload: dict[str, Any], access_token: str) -> dict[str, Any]:
    from .linkedin_client import LinkedInClient

    body, destination = payload.get("body"), payload.get("destination")
    if not isinstance(body, str) or not body or not isinstance(destination, dict):
        raise ValueError("LinkedIn effect command requires exact body and destination")
    posted = LinkedInClient(access_token).publish_post(body, destination)
    return {
        "outcome": "applied",
        "artifact": {"kind": "linkedin_api", "url": posted["url"], "fetchedAt": datetime.now(timezone.utc).isoformat(), "digest": hashlib.sha256(body.encode()).hexdigest()},
        "detail": dict(posted),
    }


def artifact_export_adapter(
    payload: dict[str, Any],
    *,
    job_id: str,
    fetch=None,
    create=None,
    fetch_receipts=None,
    read=None,
) -> dict[str, Any]:
    import base64
    from .artifact_export import export_content_artifact, verify_content_artifact_export
    from .content_artifacts import ContentArtifactRecord
    from .web_client import create_artifact, get_content_artifact, get_receipts, read_artifact

    artifact_id, artifact_digest = payload.get("artifactId"), payload.get("artifactDigest")
    if not isinstance(artifact_id, str) or not isinstance(artifact_digest, str):
        raise ValueError("content artifact export requires exact artifact identity")
    raw = (fetch or get_content_artifact)(job_id, artifact_id, artifact_digest)
    artifact = ContentArtifactRecord.model_validate(raw)
    fence = current_operation()
    if fence is None:
        raise RuntimeError("content artifact export requires a durable operation fence")
    creator = create or create_artifact

    if artifact.payload.kind == "content_pack":
        receipts = (fetch_receipts or get_receipts)(job_id)
        reader = read or read_artifact
        for item in artifact.payload.artifacts:
            constituent = ContentArtifactRecord.model_validate(
                (fetch or get_content_artifact)(job_id, item.artifactId, item.digest)
            )
            receipt = next((candidate for candidate in receipts
                if candidate.get("actionType") == "export_content_artifact"
                and candidate.get("outcome") in {"applied", "already_applied"}
                and candidate.get("detail", {}).get("artifactId") == item.artifactId
                and candidate.get("detail", {}).get("artifactDigest") == item.digest), None)
            if receipt is None:
                raise ValueError(f"content pack constituent {item.artifactId} has no verified export receipt")

            def reread(object_id: str, length: int) -> bytes | None:
                observed = reader(object_id, offset=0, length=length)
                encoded = observed.get("dataBase64")
                return base64.b64decode(encoded) if isinstance(encoded, str) else None

            verify_content_artifact_export(constituent, dict(receipt["detail"]), read=reread)

    def store(content: bytes, content_type: str) -> dict[str, Any]:
        return creator(
            job_id=job_id,
            operation_id=fence.operation_id,
            content=content,
            content_type=content_type,
            trust="model_inference",
            producer={"kind": "content_artifact_export", "id": artifact.id, "version": str(artifact.revision)},
            retention_class="audit",
        )

    detail = export_content_artifact(artifact, store=store)
    return {
        "outcome": "applied",
        "artifact": {
            "kind": "asset_store",
            "url": f"/api/internal/artifacts/{detail['jsonObjectId']}",
            "fetchedAt": datetime.now(timezone.utc).isoformat(),
            "digest": detail["jsonSha256"],
        },
        "detail": detail,
    }


def production_adapters(
    x_access_token: str = "", linkedin_access_token: str = "", *, job_id: str = "",
) -> dict[str, Adapter]:
    adapters: dict[str, Adapter] = {}
    if job_id:
        adapters["export_content_artifact"] = lambda payload, _context: artifact_export_adapter(payload, job_id=job_id)
    if x_access_token:
        adapters["publish_x_post"] = lambda payload, _context: x_publish_adapter(payload, x_access_token)
        adapters["publish_x_thread"] = lambda payload, context: x_thread_publish_adapter(
            payload, x_access_token, context=context,
        )
    if linkedin_access_token:
        adapters["publish_linkedin_post"] = lambda payload, _context: linkedin_publish_adapter(payload, linkedin_access_token)
    return adapters


def execute_effect_command(
    command: dict[str, Any],
    *,
    adapters: Mapping[str, Adapter],
    claim: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    transition: Callable[[str, dict[str, Any]], Any] | None = None,
    finalize: Callable[[dict[str, Any]], Any] | None = None,
    trace_id: str | None = None,
    claim_token: str | None = None,
) -> ExecutionResult:
    from .web_client import claim_effect, post, transition_effect_command

    claim = claim or claim_effect
    transition = transition or transition_effect_command
    finalize = finalize or (lambda payload: post("/api/internal/receipt", payload))
    trace_id = trace_id or current_trace_id()
    claim_token = claim_token or uuid.uuid4().hex
    operation_id = f"job:{command['jobId']}:effect:{command['id']}"
    identity = {
        "commandId": command["id"],
        "jobId": command["jobId"],
        "actionId": command["actionId"],
        "actionType": command["actionType"],
        "idempotencyKey": command["payloadDigest"],
        "operationId": operation_id,
        "traceId": trace_id,
        "claimToken": claim_token,
    }
    claimed = claim(identity)
    claim_outcome = claimed.get("outcome")
    if claim_outcome != "execute":
        if claim_outcome not in {"in_progress", "already_applied", "uncertain", "paused", "cancelled"}:
            raise RuntimeError(f"invalid effect claim outcome: {claim_outcome}")
        return ExecutionResult(str(claim_outcome), claimed.get("receiptId"))

    adapter = adapters.get(str(command["actionType"]))
    if adapter is None:
        raise RuntimeError(f"no adapter for effect command type '{command['actionType']}'")
    epoch = int(claimed.get("operationEpoch") or 0)
    if epoch < 1:
        raise RuntimeError("effect claim is missing its operation epoch")
    goal_digest = claimed.get("goalDigest")
    fenced = {**identity, "operationEpoch": epoch}
    with operation_scope(
        operation_id, epoch,
        goal_digest=str(goal_digest) if goal_digest else None,
    ):
        transition("dispatched", {**fenced, "attempt": int(claimed.get("attempt") or 1)})
        try:
            adapter_context = EffectAdapterContext(
                progress=dict(command.get("progress") or {}) or None,
                persist_progress=lambda progress: transition("progress", {
                    **fenced, "progress": progress,
                }),
            )
            adapter_result = adapter(dict(command["payload"]), adapter_context)
        except ProviderEffectNotStarted:
            transition("provider_not_started", fenced)
            raise
        except Exception as exc:
            transition("unknown", {**fenced, "reason": f"{type(exc).__name__}: {exc}"})
            return ExecutionResult("unknown")

        outcome = str(adapter_result.get("outcome"))
        if outcome not in {"applied", "already_applied", "rejected", "failed"}:
            transition("unknown", {**fenced, "reason": f"invalid adapter outcome: {outcome}"})
            return ExecutionResult("unknown")
        artifact = adapter_result.get("artifact")
        detail = dict(adapter_result.get("detail") or {})
        transition("observed", {
            **fenced, "outcome": outcome, "artifact": artifact, "detail": detail,
        })
        finalize({**identity, "outcome": outcome, "artifact": artifact, "detail": detail})
        return ExecutionResult(outcome)
