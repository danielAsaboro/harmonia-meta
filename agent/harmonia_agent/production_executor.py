"""Executor for sealed paid generation and cost-free production operations."""

from __future__ import annotations

import hashlib
import json
import logging
import secrets
import subprocess
from datetime import datetime, timedelta, timezone
from pathlib import Path
import tempfile
from typing import Any

from .config import settings
from .generative_media import (
    GoogleMediaTransport,
    LyriaGenerator,
    MediaOperationPending,
    MediaProviderError,
    VeoGenerator,
    validate_lyria_request,
    validate_veo_request,
)
from .usage import InvocationContext, media_usage_record
from .telemetry import current_trace_id
from .production_media import (
    CompositionCompileError,
    MediaInspectionError,
    compile_hyperframes_composition,
    create_deterministic_archive,
    create_delivery_previews,
    evaluate_media_quality,
    extract_verified_archive,
    finalize_media,
    inspect_media,
    mix_media_audio,
    repair_media as repair_media_artifact,
    render_hyperframes_composition,
)
from .web_client import (
    claim_production_operation,
    download_production_artifact,
    download_production_source,
    record_production_provider_operation,
    record_production_operation_failure,
    report_usage,
    reserve_budget,
    resolve_budget_reservation,
    start_production_provider_submission,
    upload_production_artifact,
    WebApiError,
)


class ProductionExecutionProtocolError(RuntimeError):
    """The durable claim or sealed operation is malformed or unsupported."""


logger = logging.getLogger("harmonia.production_executor")


def _next_poll_at() -> str:
    return (datetime.now(timezone.utc) + timedelta(seconds=10)).isoformat().replace("+00:00", "Z")


def inspect_generated_media_bytes(data: bytes, mime: str) -> dict[str, Any]:
    suffix = ".mp4" if mime == "video/mp4" else ".mp3" if mime == "audio/mpeg" else ".wav"
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / f"generated{suffix}"
        path.write_bytes(data)
        inspection = inspect_media(path)
    if inspection["durationSec"] <= 0:
        raise ProductionExecutionProtocolError("generated media has no positive duration")
    if mime == "video/mp4" and not inspection.get("video"):
        raise ProductionExecutionProtocolError("generated video has no video stream")
    if mime.startswith("audio/") and not inspection.get("audio"):
        raise ProductionExecutionProtocolError("generated audio has no audio stream")
    return inspection


def inspect_conditioning_image_bytes(data: bytes, mime: str) -> dict[str, Any]:
    if mime not in {"image/jpeg", "image/png"}:
        raise ProductionExecutionProtocolError("conditioning artifact must be JPEG or PNG")
    suffix = ".jpg" if mime == "image/jpeg" else ".png"
    with tempfile.TemporaryDirectory() as directory:
        path = Path(directory) / f"conditioning{suffix}"
        path.write_bytes(data)
        inspection = inspect_media(path)
    video = inspection.get("video")
    if not isinstance(video, dict) or not video.get("width") or not video.get("height"):
        raise ProductionExecutionProtocolError("conditioning artifact has no decodable image stream")
    return inspection


def _materialize_veo_conditioning(
    plan_id: str,
    request: dict[str, Any],
    inputs: Any,
    *,
    download: bool,
) -> dict[str, tuple[bytes, str, str]]:
    if not isinstance(inputs, list):
        raise ProductionExecutionProtocolError("paid production conditioning inputs are missing")
    references = [
        reference for reference in (
            request.get("sourceImageArtifact"), request.get("lastFrameArtifact"),
        ) if isinstance(reference, dict)
    ]
    expected_ids = {
        f"{plan_id}:resolve_media:{reference['artifactId']}" for reference in references
    }
    by_operation: dict[str, dict[str, Any]] = {}
    for value in inputs:
        if not isinstance(value, dict) or not isinstance(value.get("operationId"), str) or not isinstance(value.get("artifact"), dict):
            raise ProductionExecutionProtocolError("paid production conditioning input is malformed")
        by_operation[value["operationId"]] = value["artifact"]
    if set(by_operation) != expected_ids:
        raise ProductionExecutionProtocolError("paid production conditioning dependencies do not match the sealed request")
    materialized: dict[str, tuple[bytes, str, str]] = {}
    for reference in references:
        operation_id = f"{plan_id}:resolve_media:{reference['artifactId']}"
        artifact = by_operation[operation_id]
        if (
            artifact.get("digest") != reference.get("digest")
            or artifact.get("mime") != reference.get("mime")
            or artifact.get("sizeBytes") != reference.get("sizeBytes")
        ):
            raise ProductionExecutionProtocolError("conditioning artifact does not match its sealed identity")
        if not download:
            continue
        data, mime, digest = download_production_artifact(plan_id, operation_id)
        mime = mime.split(";", 1)[0]
        if digest != reference["digest"] or mime != reference["mime"] or len(data) != reference["sizeBytes"]:
            raise ProductionExecutionProtocolError("conditioning artifact does not match its sealed identity")
        inspect_conditioning_image_bytes(data, mime)
        materialized[reference["artifactId"]] = (data, mime, digest)
    return materialized


def _target_dimensions(plan: dict[str, Any]) -> tuple[int, int]:
    target = plan.get("target")
    if not isinstance(target, dict):
        raise ProductionExecutionProtocolError("production plan target is missing")
    aspect = target.get("aspectRatio")
    resolution = target.get("resolution")
    base = {
        "9:16": (1080, 1920),
        "16:9": (1920, 1080),
        "1:1": (1080, 1080),
        "4:5": (1080, 1350),
    }.get(str(aspect))
    if base is None:
        raise ProductionExecutionProtocolError("production target aspect ratio is unsupported")
    multiplier = 2 if resolution == "4k" else 1
    return base[0] * multiplier, base[1] * multiplier


def _json_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


def _artifact_extension(mime: str) -> str:
    return {
        "video/mp4": ".mp4",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "application/zip": ".zip",
        "application/json": ".json",
    }.get(mime, ".bin")


def _download_inputs(plan_id: str, inputs: list[dict[str, Any]]) -> dict[str, tuple[bytes, str, str]]:
    downloaded: dict[str, tuple[bytes, str, str]] = {}
    for value in inputs:
        operation_id = value.get("operationId")
        artifact = value.get("artifact")
        if not isinstance(operation_id, str) or not isinstance(artifact, dict):
            raise ProductionExecutionProtocolError("internal production input is malformed")
        data, mime, digest = download_production_artifact(plan_id, operation_id)
        if digest != artifact.get("digest") or mime.split(";", 1)[0] != artifact.get("mime"):
            raise ProductionExecutionProtocolError("downloaded production input binding mismatch")
        downloaded[operation_id] = (data, mime.split(";", 1)[0], digest)
    return downloaded


def _upload_internal_result(
    plan_id: str,
    operation_id: str,
    claim: dict[str, Any],
    token: str,
    data: bytes,
    mime: str,
    metadata: dict[str, Any],
) -> dict[str, Any]:
    return upload_production_artifact(
        plan_id,
        operation_id,
        claim_id=str(claim["id"]),
        claim_token=token,
        mime=mime,
        digest=hashlib.sha256(data).hexdigest(),
        data=data,
        operation_metadata=metadata,
    )


def _execute_internal_operation(
    plan_id: str,
    operation_id: str,
    token: str,
    decision: dict[str, Any],
) -> dict[str, Any]:
    claim = decision["claim"]
    operation = decision.get("operation")
    plan = decision.get("plan")
    inputs = decision.get("inputs")
    if not isinstance(operation, dict) or operation.get("executionAuthority") != "internal":
        raise ProductionExecutionProtocolError("internal production authority binding is invalid")
    if not isinstance(plan, dict) or not isinstance(inputs, list):
        raise ProductionExecutionProtocolError("internal production execution context is incomplete")
    downloaded = _download_inputs(plan_id, inputs)
    operation_type = operation.get("type")
    with tempfile.TemporaryDirectory() as directory:
        workspace = Path(directory)
        if operation_type == "resolve_media":
            reference = operation.get("payload")
            if not isinstance(reference, dict):
                raise ProductionExecutionProtocolError("sealed source artifact reference is missing")
            artifact_id = reference.get("artifactId")
            expected_digest = reference.get("digest")
            expected_mime = reference.get("mime")
            expected_size = reference.get("sizeBytes")
            rights_authorization_id = reference.get("rightsAuthorizationId")
            if (
                not isinstance(artifact_id, str)
                or not isinstance(expected_digest, str)
                or len(expected_digest) != 64
                or not isinstance(expected_mime, str)
                or not isinstance(expected_size, int)
                or expected_size < 1
                or not isinstance(rights_authorization_id, str)
                or not rights_authorization_id
            ):
                raise ProductionExecutionProtocolError("sealed source artifact reference is malformed")
            data, mime, digest = download_production_source(
                plan_id,
                operation_id,
                claim_id=str(claim["id"]),
                claim_token=token,
            )
            mime = mime.split(";", 1)[0]
            if digest != expected_digest or mime != expected_mime or len(data) != expected_size:
                raise ProductionExecutionProtocolError("materialized source does not match its sealed identity")
            inspection = (
                inspect_conditioning_image_bytes(data, mime)
                if mime in {"image/jpeg", "image/png"}
                else inspect_generated_media_bytes(data, mime)
            )
            metadata = {
                "kind": "verified_source_materialization",
                "artifactId": artifact_id,
                "artifactDigest": digest,
                "rightsAuthorizationId": rights_authorization_id,
                "inspection": inspection,
            }
        elif operation_type == "build_composition":
            assets = workspace / "assets"
            assets.mkdir()
            scenes: list[dict[str, Any]] = []
            for scene in sorted(plan.get("scenes") or [], key=lambda value: value.get("order", 0)):
                spec = scene.get("video")
                source_reference = scene.get("sourceArtifact")
                if isinstance(source_reference, dict):
                    artifact_id = source_reference.get("artifactId")
                    if not isinstance(artifact_id, str):
                        raise ProductionExecutionProtocolError("scene source artifact identity is missing")
                    source_id = f"{plan_id}:resolve_media:{artifact_id}"
                elif isinstance(spec, dict):
                    generated_type = "extend_video" if spec.get("mode") == "extend_video" else "generate_video"
                    source_id = f"{plan_id}:{generated_type}:{scene['id']}"
                else:
                    raise ProductionExecutionProtocolError("scene media source is missing")
                if source_id not in downloaded:
                    raise ProductionExecutionProtocolError("scene artifact is missing")
                data, mime, digest = downloaded[source_id]
                if mime != "video/mp4":
                    raise ProductionExecutionProtocolError("scene input is not verified MP4 video")
                if isinstance(source_reference, dict) and (
                    source_reference.get("digest") != digest or source_reference.get("mime") != mime
                ):
                    raise ProductionExecutionProtocolError("scene source input does not match the sealed plan")
                relative = f"assets/{digest}.mp4"
                (workspace / relative).write_bytes(data)
                scenes.append({
                    "id": scene["id"],
                    "startSec": scene["startSec"],
                    "durationSec": scene["durationSec"],
                    "videoPath": relative,
                    "title": scene.get("purpose") or "",
                    "mediaStartSec": (scene.get("sourceWindow") or {}).get("startSec", 0),
                    "preserveSourceAudio": bool(
                        scene.get("preserveSourceAudio") if isinstance(source_reference, dict)
                        else spec.get("generateAudio", False) if isinstance(spec, dict) else False
                    ),
                    "reframe": scene.get("reframe") or {"xPercent": 50, "yPercent": 50, "scale": 1},
                    "captions": scene.get("captions") or [],
                })
            music = None
            music_id = f"{plan_id}:generate_music"
            if music_id in downloaded:
                data, mime, digest = downloaded[music_id]
                if not mime.startswith("audio/"):
                    raise ProductionExecutionProtocolError("soundtrack input is not verified audio")
                relative = f"assets/{digest}{_artifact_extension(mime)}"
                (workspace / relative).write_bytes(data)
                music = {"path": relative, "volume": 0.8}
            narration: list[dict[str, Any]] = []
            for clip in plan.get("narration") or []:
                reference = clip.get("artifact") if isinstance(clip, dict) else None
                artifact_id = reference.get("artifactId") if isinstance(reference, dict) else None
                if not isinstance(artifact_id, str):
                    raise ProductionExecutionProtocolError("narration artifact identity is missing")
                source_id = f"{plan_id}:resolve_media:{artifact_id}"
                if source_id not in downloaded:
                    raise ProductionExecutionProtocolError("narration artifact is missing")
                data, mime, digest = downloaded[source_id]
                if not mime.startswith("audio/") or reference.get("digest") != digest or reference.get("mime") != mime:
                    raise ProductionExecutionProtocolError("narration input does not match the sealed plan")
                relative = f"assets/{digest}{_artifact_extension(mime)}"
                (workspace / relative).write_bytes(data)
                narration.append({
                    "id": clip.get("id"),
                    "path": relative,
                    "startSec": clip.get("startSec"),
                    "durationSec": clip.get("durationSec"),
                })
            width, height = _target_dimensions(plan)
            manifest = compile_hyperframes_composition({
                "id": plan_id,
                "durationSec": plan["target"]["durationSec"],
                "width": width,
                "height": height,
                "scenes": scenes,
                "narration": narration,
                **({"music": music} if music else {}),
            }, workspace)
            try:
                version = subprocess.run(
                    ["hyperframes", "--version"], check=True, capture_output=True, text=True, timeout=30,
                ).stdout.strip()
            except (OSError, subprocess.SubprocessError) as exc:
                raise ProductionExecutionProtocolError("pinned HyperFrames CLI is unavailable") from exc
            manifest.update({
                "planDigest": claim["planDigest"],
                "operationId": operation_id,
                "inputDigests": claim["inputDigests"],
                "hyperframesVersion": version,
            })
            (workspace / "composition-manifest.json").write_bytes(_json_bytes(manifest))
            data = create_deterministic_archive(workspace)
            mime = "application/zip"
            metadata = {"kind": "composition_workspace", "manifest": manifest}
        elif operation_type == "render_composition":
            source = next(iter(downloaded.values()), None)
            if source is None or source[1] != "application/zip":
                raise ProductionExecutionProtocolError("render input is not a composition archive")
            extract_verified_archive(source[0], workspace)
            output = render_hyperframes_composition(workspace, workspace / "render.mp4")
            data = output.read_bytes()
            mime = "video/mp4"
            metadata = {"kind": "hyperframes_render", "inspection": inspect_media(output)}
        elif operation_type in {"mix_audio", "ffmpeg_finalize"}:
            source = next(iter(downloaded.values()), None)
            if source is None or source[1] != "video/mp4":
                raise ProductionExecutionProtocolError("ffmpeg input is not verified MP4 video")
            source_path = workspace / "input.mp4"
            source_path.write_bytes(source[0])
            output = workspace / "output.mp4"
            if operation_type == "mix_audio":
                mix_media_audio(source_path, output)
                kind = "ffmpeg_audio_mix"
            else:
                width, height = _target_dimensions(plan)
                finalize_media(
                    source_path,
                    output,
                    width=width,
                    height=height,
                    frame_rate=int(plan["target"]["frameRate"]),
                )
                kind = "ffmpeg_final"
            data = output.read_bytes()
            mime = "video/mp4"
            metadata = {"kind": kind, "inspection": inspect_media(output)}
        elif operation_type in {"inspect_media", "inspect_delivery"}:
            source = next(iter(downloaded.values()), None)
            if source is None or source[1] != "video/mp4":
                raise ProductionExecutionProtocolError("inspection input is not verified MP4 video")
            path = workspace / "final.mp4"
            path.write_bytes(source[0])
            report = inspect_media(path)
            data = _json_bytes(report)
            mime = "application/json"
            metadata = {"kind": operation_type, "report": report}
        elif operation_type in {"evaluate_production", "evaluate_delivery"}:
            source = next(iter(downloaded.values()), None)
            if source is None or source[1] != "application/json":
                raise ProductionExecutionProtocolError("QA input is not an inspection receipt")
            inspection = json.loads(source[0])
            width, height = _target_dimensions(plan)
            report = evaluate_media_quality(inspection, {
                "durationSec": plan["target"]["durationSec"],
                "width": width,
                "height": height,
                "frameRate": plan["target"]["frameRate"],
            })
            if operation_type == "evaluate_delivery" and not report["passed"]:
                raise ProductionExecutionProtocolError(
                    "production QA failed: " + ",".join(report["issues"])
                )
            data = _json_bytes(report)
            mime = "application/json"
            metadata = {"kind": operation_type, "report": report}
        elif operation_type == "repair_media":
            final_input = next((value for key, value in downloaded.items() if key.endswith(":ffmpeg_finalize")), None)
            qa_input = next((value for key, value in downloaded.items() if key.endswith(":evaluate_production")), None)
            if final_input is None or final_input[1] != "video/mp4" or qa_input is None or qa_input[1] != "application/json":
                raise ProductionExecutionProtocolError("deterministic repair inputs are incomplete")
            try:
                qa = json.loads(qa_input[0])
            except json.JSONDecodeError as exc:
                raise ProductionExecutionProtocolError("deterministic repair QA receipt is malformed") from exc
            source_path = workspace / "final.mp4"
            source_path.write_bytes(final_input[0])
            if qa.get("passed") is True:
                output = source_path
                repair_receipt = {"attempt": 0, "inputIssues": [], "qa": qa}
            else:
                width, height = _target_dimensions(plan)
                output, repair_receipt = repair_media_artifact(
                    source_path,
                    workspace / "repaired.mp4",
                    target={
                        "durationSec": plan["target"]["durationSec"],
                        "width": width,
                        "height": height,
                        "frameRate": plan["target"]["frameRate"],
                    },
                    issues=list(qa.get("issues") or []),
                )
            data = output.read_bytes()
            mime = "video/mp4"
            metadata = {"kind": "deterministic_repair", "receipt": repair_receipt, "inspection": inspect_media(output)}
        elif operation_type == "assemble_export":
            final_input = next((value for key, value in downloaded.items() if key.endswith(":repair_media")), None)
            qa_input = next((value for key, value in downloaded.items() if key.endswith(":evaluate_delivery")), None)
            if final_input is None or final_input[1] != "video/mp4" or qa_input is None or qa_input[1] != "application/json":
                raise ProductionExecutionProtocolError("content pack inputs are incomplete")
            pack = workspace / "pack"
            pack.mkdir()
            (pack / "final.mp4").write_bytes(final_input[0])
            (pack / "qa.json").write_bytes(qa_input[0])
            create_delivery_previews(
                pack / "final.mp4", pack / "thumbnail.jpg", pack / "contact-sheet.jpg",
            )
            receipt = {
                "schemaVersion": 1,
                "planId": plan_id,
                "planDigest": claim["planDigest"],
                "artifacts": {key: value[2] for key, value in sorted(downloaded.items())},
            }
            (pack / "export-receipt.json").write_bytes(_json_bytes(receipt))
            data = create_deterministic_archive(pack)
            mime = "application/zip"
            metadata = {"kind": "content_pack", "receipt": receipt}
        else:
            raise ProductionExecutionProtocolError(f"unsupported internal production operation: {operation_type}")
    completed = _upload_internal_result(
        plan_id, operation_id, claim, token, data, mime, metadata,
    )
    return {"outcome": "succeeded", "claim": completed}


def execute_production_operation(
    plan_id: str,
    operation_id: str,
    *,
    claim_token: str | None = None,
    plan_revision: int = 0,
    plan_digest: str = "0" * 64,
    internal_run: int = 0,
) -> dict[str, Any]:
    token = claim_token or secrets.token_urlsafe(32)
    decision = claim_production_operation(
        plan_id, operation_id, token, plan_revision, plan_digest, internal_run,
    )
    outcome = str(decision.get("outcome") or "")
    claim = decision.get("claim")
    if not isinstance(claim, dict):
        raise ProductionExecutionProtocolError("production claim response is missing its claim")
    if outcome == "already_succeeded":
        return {"outcome": outcome, "artifact": claim.get("artifact")}
    if outcome != "execute":
        return {"outcome": outcome}

    if claim.get("kind") == "internal":
        try:
            return _execute_internal_operation(plan_id, operation_id, token, decision)
        except (
            ProductionExecutionProtocolError,
            CompositionCompileError,
            MediaInspectionError,
            json.JSONDecodeError,
        ) as exc:
            record_production_operation_failure(
                plan_id,
                operation_id,
                claim_id=claim["id"],
                claim_token=token,
                outcome="failed",
                reason=f"{type(exc).__name__}: {exc}"[:2000],
            )
            raise
    if claim.get("kind") != "paid":
        raise ProductionExecutionProtocolError("production claim kind is invalid")

    operation = decision.get("operation")
    if not isinstance(operation, dict):
        raise ProductionExecutionProtocolError("production claim response is missing its sealed operation")
    if operation.get("id") != operation_id or operation.get("executionAuthority") != "production_mandate":
        raise ProductionExecutionProtocolError("production operation authority binding is invalid")
    sealed_cost = operation.get("estimatedCostUsd")
    if not isinstance(sealed_cost, str) or sealed_cost != claim.get("reservedCostUsd"):
        raise ProductionExecutionProtocolError("production claim cost does not match the sealed operation")
    operation_type = operation.get("type")
    if operation_type not in {"generate_video", "extend_video", "generate_music"}:
        raise ProductionExecutionProtocolError("executor received a non-paid production operation")

    provider = "lyria" if operation_type == "generate_music" else "veo"
    role = "lyria_generator" if provider == "lyria" else "veo_generator"
    model_request = (
        validate_lyria_request(operation.get("payload"))
        if provider == "lyria"
        else validate_veo_request(operation.get("payload"))
    )
    model = str(model_request["providerModel"])
    persisted_provider_id = claim.get("providerOperationId")
    conditioning_media: dict[str, tuple[bytes, str, str]] = {}
    if provider == "veo":
        try:
            conditioning_media = _materialize_veo_conditioning(
                plan_id,
                model_request,
                decision.get("inputs"),
                download=not bool(persisted_provider_id),
            )
        except ProductionExecutionProtocolError as exc:
            record_production_operation_failure(
                plan_id,
                operation_id,
                claim_id=claim["id"],
                claim_token=token,
                outcome="failed",
                reason=f"conditioning artifact verification failed: {exc}"[:2000],
            )
            return {"outcome": "failed", "reason": "conditioning artifact verification failed"}
    config = settings()
    media_output_bucket = getattr(config, "media_output_bucket", None)
    if provider == "veo" and not media_output_bucket:
        record_production_operation_failure(
            plan_id,
            operation_id,
            claim_id=claim["id"],
            claim_token=token,
            outcome="failed",
            reason="MEDIA_OUTPUT_BUCKET is required for authorized Veo output",
        )
        return {"outcome": "failed", "reason": "authorized Veo output storage unavailable"}
    authorized_output_prefix = (
        f"gs://{media_output_bucket}/workspaces/{claim['workspaceId']}/brands/{claim['brandId']}"
        f"/jobs/{claim['jobId']}/plans/{plan_id}/claims/{claim['id']}/"
        if provider == "veo" else None
    )
    budget_operation_id = f"production:{claim['id']}"
    try:
        reserve_budget({
            "jobId": claim["jobId"],
            "operationId": budget_operation_id,
            "stage": "production",
            "role": role,
            "model": model,
            "estimatedCostUsd": sealed_cost,
            "pricingVersion": claim.get("pricingVersion") or "sealed-production-plan",
            "productionAuthorization": {
                "planId": plan_id,
                "operationId": operation_id,
                "claimId": claim["id"],
                "claimToken": token,
            },
        })
    except Exception as exc:
        rejected = isinstance(exc, WebApiError) and exc.permanent
        reason = "budget authorization rejected" if rejected else "budget reservation unavailable"
        record_production_operation_failure(
            plan_id,
            operation_id,
            claim_id=claim["id"],
            claim_token=token,
            outcome="failed",
            reason=f"{reason}: {type(exc).__name__}",
        )
        if not rejected:
            try:
                resolve_budget_reservation({
                    "jobId": claim["jobId"],
                    "operationId": budget_operation_id,
                    "outcome": "not_invoked",
                    "reason": "budget reservation response failed before provider invocation",
                })
            except Exception:  # noqa: BLE001 - the production failure receipt remains authoritative
                logger.exception("failed to reconcile pre-provider production budget %s", budget_operation_id)
        return {"outcome": "failed", "reason": reason}

    active_provider_id = str(persisted_provider_id) if persisted_provider_id else None
    if provider == "lyria" and persisted_provider_id:
        raise ProductionExecutionProtocolError(
            "persisted Lyria identity cannot be resubmitted or resumed by this provider interface"
        )
    if not persisted_provider_id:
        try:
            start_production_provider_submission(
                plan_id,
                operation_id,
                claim_id=claim["id"],
                claim_token=token,
                provider=provider,
            )
        except Exception as exc:
            reason = f"provider submission authorization failed: {type(exc).__name__}"
            record_production_operation_failure(
                plan_id,
                operation_id,
                claim_id=claim["id"],
                claim_token=token,
                outcome="failed",
                reason=reason,
            )
            try:
                resolve_budget_reservation({
                    "jobId": claim["jobId"],
                    "operationId": budget_operation_id,
                    "outcome": "not_invoked",
                    "reason": "provider submission authorization failed before provider invocation",
                })
            except Exception:  # noqa: BLE001 - the production failure receipt is authoritative
                logger.exception("failed to release pre-provider production budget %s", budget_operation_id)
            return {"outcome": "failed", "reason": "provider submission authorization failed"}

    transport = GoogleMediaTransport(
        project=config.gcp_project,
        location=config.vertex_media_location,
    )

    def persist_provider(provider_operation_id: str) -> None:
        nonlocal active_provider_id
        record_production_provider_operation(
            plan_id,
            operation_id,
            claim_id=claim["id"],
            claim_token=token,
            provider=provider,
            provider_operation_id=provider_operation_id,
            next_poll_at=_next_poll_at(),
        )
        active_provider_id = provider_operation_id

    def quarantine(exc: Exception, outcome: str) -> None:
        reason = f"{type(exc).__name__}: {exc}"[:2000]
        try:
            record_production_operation_failure(
                plan_id,
                operation_id,
                claim_id=claim["id"],
                claim_token=token,
                outcome=outcome,
                reason=reason,
            )
        except Exception:  # noqa: BLE001 - preserve the causal production failure
            logger.exception("failed to quarantine production claim %s", claim["id"])
        try:
            resolve_budget_reservation({
                "jobId": claim["jobId"],
                "operationId": budget_operation_id,
                "outcome": "uncertain",
                "reason": "paid production provider outcome is ambiguous",
            })
        except Exception:  # noqa: BLE001 - preserve the causal production failure
            logger.exception("failed to quarantine production budget %s", budget_operation_id)

    try:
        if provider == "veo":
            generated = VeoGenerator(transport=transport).generate(
                request=model_request,
                existing_operation=str(persisted_provider_id) if persisted_provider_id else None,
                persist_operation=persist_provider,
                authorized_output_prefix=authorized_output_prefix,
                conditioning_media=conditioning_media,
            )
        else:
            generated = LyriaGenerator(transport=transport).generate(
                request=model_request,
                estimated_cost_usd=sealed_cost,
            )
            persist_provider(generated.provider_id)
    except MediaOperationPending as exc:
        persist_provider(exc.operation_name)
        return {"outcome": "waiting_provider", "providerOperationId": exc.operation_name}
    except MediaProviderError as exc:
        if active_provider_id and not exc.permanent:
            persist_provider(active_provider_id)
            return {"outcome": "waiting_provider", "providerOperationId": active_provider_id}
        quarantine(exc, "failed" if active_provider_id else "uncertain")
        raise
    except Exception as exc:
        quarantine(exc, "failed" if active_provider_id else "uncertain")
        raise

    try:
        inspection = inspect_generated_media_bytes(generated.data, generated.mime)
        digest = hashlib.sha256(generated.data).hexdigest()
        provider_metadata = {
            "provider": provider,
            "providerOperationId": generated.provider_id,
            "model": generated.model,
            "durationSec": generated.duration_sec,
            "estimatedCostUsd": sealed_cost,
            "inspection": inspection,
            "providerResponse": generated.provider_metadata,
        }
        completed = upload_production_artifact(
            plan_id,
            operation_id,
            claim_id=claim["id"],
            claim_token=token,
            mime=generated.mime,
            digest=digest,
            data=generated.data,
            operation_metadata=provider_metadata,
        )
    except Exception as exc:
        quarantine(exc, "failed")
        raise
    try:
        report_usage(media_usage_record(
            invocation=InvocationContext(
                job_id=claim["jobId"],
                workspace_id=claim["workspaceId"],
                brand_id=claim["brandId"],
                user_id="production-service",
                stage="production",
                operation_id=budget_operation_id,
            ),
            role=role,
            model=generated.model,
            estimated_cost_usd=sealed_cost,
            trace_id=current_trace_id(),
        ).to_wire())
    except Exception:  # noqa: BLE001 - the durable production receipt is already complete
        logger.exception("usage reporting failed after production claim %s completed", claim["id"])
    return {"outcome": "succeeded", "claim": completed}
