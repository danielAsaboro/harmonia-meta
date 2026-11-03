"""The paid media executor is isolated from publication and bound to sealed claims."""

from __future__ import annotations

from types import SimpleNamespace
from pathlib import Path
import hashlib
import json
import subprocess

from harmonia_agent import production_executor
from harmonia_agent.generative_media import GeneratedMedia, MediaOperationPending, MediaProviderError
from harmonia_agent.web_client import WebApiError


def _operation() -> dict:
    return {
        "id": "plan-1:generate_video:scene-1",
        "jobId": "job-1",
        "type": "generate_video",
        "dependsOn": [],
        "payload": {
            "modelCapability": "veo-3.1-fast",
            "mode": "text_to_video",
            "prompt": "calm blue network",
            "durationSec": 4,
            "aspectRatio": "9:16",
            "resolution": "1080p",
            "generateAudio": False,
            "enhancePrompt": True,
            "outputCount": 1,
        },
        "requestDigest": "a" * 64,
        "estimatedCostUsd": "0.320000",
        "executionAuthority": "production_mandate",
    }


def _claim(*, provider_operation_id: str | None = None) -> dict:
    claim = {
        "kind": "paid",
        "id": "claim-1",
        "planId": "plan-1",
        "jobId": "job-1",
        "workspaceId": "workspace-1",
        "brandId": "brand-1",
        "pricingVersion": "2026-08-31",
        "operationId": _operation()["id"],
        "reservedCostUsd": "0.320000",
        "state": "claimed",
        "inputDigests": [],
    }
    if provider_operation_id:
        claim.update(provider="veo", providerOperationId=provider_operation_id)
    return {"outcome": "execute", "claim": claim, "operation": _operation(), "inputs": []}


def _conditioned_claim(*, provider_operation_id: str | None = None) -> dict:
    reference = {
        "artifactId": "018f47a2-4f40-7b1f-b19f-8f6b916b7d13",
        "digest": "3" * 64,
        "mime": "image/png",
        "sizeBytes": 5,
        "rightsAuthorizationId": "license-first",
    }
    operation = {
        **_operation(),
        "dependsOn": ["plan-1:resolve_media:018f47a2-4f40-7b1f-b19f-8f6b916b7d13"],
        "payload": {
            **_operation()["payload"],
            "mode": "image_to_video",
            "sourceImageArtifact": reference,
        },
    }
    decision = _claim(provider_operation_id=provider_operation_id)
    decision["operation"] = operation
    decision["claim"]["inputDigests"] = [{
        "operationId": operation["dependsOn"][0], "digest": reference["digest"],
    }]
    decision["inputs"] = [{
        "operationId": operation["dependsOn"][0],
        "artifact": {
            "mime": "image/png", "digest": reference["digest"], "sizeBytes": 5,
            "objectKey": "durable-artifacts/workspace-1/brand-1/production/frame.png",
        },
    }]
    return decision


def test_executor_claims_sealed_operation_before_provider_and_uploads_verified_bytes(monkeypatch):
    order: list[str] = []
    provider_records: list[dict] = []
    uploads: list[dict] = []
    inspected: list[tuple[bytes, str]] = []

    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: order.append("claim") or _claim())
    monkeypatch.setattr(production_executor, "settings", lambda: SimpleNamespace(gcp_project="project-1", vertex_media_location="us-central1", media_output_bucket="media-bucket"))
    monkeypatch.setattr(production_executor, "GoogleMediaTransport", lambda **_kwargs: object())

    def generate(_self, *, request, existing_operation, persist_operation, authorized_output_prefix, conditioning_media):
        assert order == ["claim", "budget:0.320000", "submission"]
        assert existing_operation is None
        assert conditioning_media == {}
        assert authorized_output_prefix == "gs://media-bucket/workspaces/workspace-1/brands/brand-1/jobs/job-1/plans/plan-1/claims/claim-1/"
        persist_operation("projects/p/locations/us-central1/operations/veo-1")
        return GeneratedMedia(
            data=b"real-video-bytes",
            mime="video/mp4",
            model="veo-3.1-fast-generate-001",
            provider_id="projects/p/locations/us-central1/operations/veo-1",
            duration_sec=4,
            estimated_cost_usd="999.000000",
            provider_metadata={"gcsUri": authorized_output_prefix + "123/sample_0.mp4", "raiMediaFilteredCount": 0},
        )

    monkeypatch.setattr(production_executor.VeoGenerator, "generate", generate)
    monkeypatch.setattr(production_executor, "record_production_provider_operation", lambda *args, **kwargs: provider_records.append(kwargs))
    monkeypatch.setattr(production_executor, "upload_production_artifact", lambda *args, **kwargs: uploads.append(kwargs) or {"state": "succeeded"})
    def reserve(payload):
        assert payload["productionAuthorization"] == {
            "planId": "plan-1", "operationId": "plan-1:generate_video:scene-1",
            "claimId": "claim-1", "claimToken": "worker-1",
        }
        order.append(f"budget:{payload['estimatedCostUsd']}")

    monkeypatch.setattr(production_executor, "reserve_budget", reserve)
    monkeypatch.setattr(production_executor, "report_usage", lambda _payload: None)
    monkeypatch.setattr(production_executor, "inspect_generated_media_bytes", lambda data, mime: inspected.append((data, mime)) or {"durationSec": 4.0, "video": {"codec": "h264"}})
    monkeypatch.setattr(production_executor, "start_production_provider_submission", lambda *_args, **_kwargs: order.append("submission"))

    result = production_executor.execute_production_operation("plan-1", _operation()["id"], claim_token="worker-1")

    assert result["outcome"] == "succeeded"
    assert order[:3] == ["claim", "budget:0.320000", "submission"]
    assert provider_records[0]["provider_operation_id"].endswith("veo-1")
    assert uploads[0]["data"] == b"real-video-bytes"
    assert uploads[0]["operation_metadata"]["estimatedCostUsd"] == "0.320000"
    assert uploads[0]["operation_metadata"]["inspection"]["video"]["codec"] == "h264"
    assert uploads[0]["operation_metadata"]["providerResponse"] == {
        "gcsUri": "gs://media-bucket/workspaces/workspace-1/brands/brand-1/jobs/job-1/plans/plan-1/claims/claim-1/123/sample_0.mp4",
        "raiMediaFilteredCount": 0,
    }
    assert inspected == [(b"real-video-bytes", "video/mp4")]


def test_provider_poll_timestamp_uses_rfc3339_z_suffix():
    value = production_executor._next_poll_at()
    assert value.endswith("Z")
    assert "+00:00" not in value


def test_executor_materializes_exact_conditioning_input_before_budget_and_provider(monkeypatch):
    order: list[str] = []
    generated_inputs: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: _conditioned_claim())
    monkeypatch.setattr(production_executor, "download_production_artifact", lambda *_args: order.append("download") or (b"first", "image/png", "3" * 64))
    monkeypatch.setattr(production_executor, "inspect_conditioning_image_bytes", lambda data, mime: order.append(f"inspect:{mime}:{len(data)}") or {"video": {"width": 1080, "height": 1920}} , raising=False)
    monkeypatch.setattr(production_executor, "settings", lambda: SimpleNamespace(gcp_project="project-1", vertex_media_location="us-central1", media_output_bucket="media-bucket"))
    monkeypatch.setattr(production_executor, "reserve_budget", lambda _payload: order.append("budget"))
    monkeypatch.setattr(production_executor, "start_production_provider_submission", lambda *_args, **_kwargs: order.append("submission"))
    monkeypatch.setattr(production_executor, "GoogleMediaTransport", lambda **_kwargs: object())
    monkeypatch.setattr(production_executor, "record_production_provider_operation", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(production_executor, "inspect_generated_media_bytes", lambda *_args: {"durationSec": 4, "video": {"codec": "h264"}})
    monkeypatch.setattr(production_executor, "upload_production_artifact", lambda *_args, **_kwargs: {"state": "succeeded"})
    monkeypatch.setattr(production_executor, "report_usage", lambda _payload: None)

    def generate(_self, *, conditioning_media, persist_operation, **_kwargs):
        generated_inputs.append(conditioning_media)
        assert order == ["download", "inspect:image/png:5", "budget", "submission"]
        persist_operation("operations/conditioned")
        return GeneratedMedia(
            data=b"video", mime="video/mp4", model="veo-3.1-fast-generate-001",
            provider_id="operations/conditioned", duration_sec=4, estimated_cost_usd="0.320000",
        )

    monkeypatch.setattr(production_executor.VeoGenerator, "generate", generate)

    result = production_executor.execute_production_operation(
        "plan-1", _operation()["id"], claim_token="conditioned-worker",
    )

    assert result["outcome"] == "succeeded"
    assert generated_inputs == [{
        "018f47a2-4f40-7b1f-b19f-8f6b916b7d13": (b"first", "image/png", "3" * 64),
    }]


def test_executor_fails_conditioning_identity_mismatch_before_budget_or_provider(monkeypatch):
    failures: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: _conditioned_claim())
    monkeypatch.setattr(production_executor, "download_production_artifact", lambda *_args: (b"first", "image/png", "9" * 64))
    monkeypatch.setattr(production_executor, "reserve_budget", lambda _payload: (_ for _ in ()).throw(AssertionError("budget must not be reserved")))
    monkeypatch.setattr(production_executor, "start_production_provider_submission", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("provider must not be armed")))
    monkeypatch.setattr(production_executor, "record_production_operation_failure", lambda *args, **kwargs: failures.append(kwargs) or {"state": "failed"})

    result = production_executor.execute_production_operation(
        "plan-1", _operation()["id"], claim_token="bad-conditioning-worker",
    )

    assert result == {"outcome": "failed", "reason": "conditioning artifact verification failed"}
    assert failures[0]["outcome"] == "failed"
    assert "sealed identity" in failures[0]["reason"]


def test_executor_resumes_persisted_veo_identity_without_duplicate_submission(monkeypatch):
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: _claim(provider_operation_id="operations/existing"))
    monkeypatch.setattr(production_executor, "settings", lambda: SimpleNamespace(gcp_project="project-1", vertex_media_location="us-central1", media_output_bucket="media-bucket"))
    monkeypatch.setattr(production_executor, "GoogleMediaTransport", lambda **_kwargs: object())
    monkeypatch.setattr(production_executor, "reserve_budget", lambda _payload: None)
    monkeypatch.setattr(production_executor, "start_production_provider_submission", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("resume must not start a new submission")))

    def pending(_self, *, existing_operation, persist_operation, **_kwargs):
        assert existing_operation == "operations/existing"
        persist_operation("operations/existing")
        raise MediaOperationPending("operations/existing")

    monkeypatch.setattr(production_executor.VeoGenerator, "generate", pending)
    monkeypatch.setattr(production_executor, "record_production_provider_operation", lambda *_args, **_kwargs: None)

    result = production_executor.execute_production_operation("plan-1", _operation()["id"], claim_token="worker-2")

    assert result == {"outcome": "waiting_provider", "providerOperationId": "operations/existing"}


def test_executor_resumes_conditioned_veo_without_redownloading_inputs(monkeypatch):
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: _conditioned_claim(provider_operation_id="operations/existing"))
    monkeypatch.setattr(production_executor, "download_production_artifact", lambda *_args: (_ for _ in ()).throw(AssertionError("resume must not rematerialize conditioning")))
    monkeypatch.setattr(production_executor, "settings", lambda: SimpleNamespace(gcp_project="project-1", vertex_media_location="us-central1", media_output_bucket="media-bucket"))
    monkeypatch.setattr(production_executor, "GoogleMediaTransport", lambda **_kwargs: object())
    monkeypatch.setattr(production_executor, "reserve_budget", lambda _payload: None)
    monkeypatch.setattr(production_executor, "start_production_provider_submission", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("resume must not start a new submission")))
    monkeypatch.setattr(production_executor, "record_production_provider_operation", lambda *_args, **_kwargs: None)

    def pending(_self, *, conditioning_media, existing_operation, **_kwargs):
        assert conditioning_media == {}
        assert existing_operation == "operations/existing"
        raise MediaOperationPending("operations/existing")

    monkeypatch.setattr(production_executor.VeoGenerator, "generate", pending)

    result = production_executor.execute_production_operation(
        "plan-1", _operation()["id"], claim_token="conditioned-resume-worker",
    )

    assert result == {"outcome": "waiting_provider", "providerOperationId": "operations/existing"}


def test_executor_returns_terminal_duplicate_without_invoking_provider(monkeypatch):
    duplicate = _claim()
    duplicate["outcome"] = "already_succeeded"
    duplicate["claim"].update(state="succeeded", artifact={"digest": "b" * 64})
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: duplicate)
    monkeypatch.setattr(production_executor, "GoogleMediaTransport", lambda **_kwargs: (_ for _ in ()).throw(AssertionError("provider must not run")))

    result = production_executor.execute_production_operation("plan-1", _operation()["id"], claim_token="worker-3")

    assert result == {"outcome": "already_succeeded", "artifact": {"digest": "b" * 64}}


def test_executor_quarantines_ambiguous_provider_failure_without_resubmission(monkeypatch):
    failures: list[dict] = []
    resolutions: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: _claim())
    monkeypatch.setattr(production_executor, "settings", lambda: SimpleNamespace(gcp_project="project-1", vertex_media_location="us-central1", media_output_bucket="media-bucket"))
    monkeypatch.setattr(production_executor, "GoogleMediaTransport", lambda **_kwargs: object())
    monkeypatch.setattr(production_executor, "reserve_budget", lambda _payload: None)
    monkeypatch.setattr(production_executor, "start_production_provider_submission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(production_executor.VeoGenerator, "generate", lambda *_args, **_kwargs: (_ for _ in ()).throw(TimeoutError("provider timeout")))
    monkeypatch.setattr(production_executor, "record_production_operation_failure", lambda *args, **kwargs: failures.append(kwargs))
    monkeypatch.setattr(production_executor, "resolve_budget_reservation", resolutions.append)

    try:
        production_executor.execute_production_operation("plan-1", _operation()["id"], claim_token="worker-4")
    except TimeoutError as exc:
        assert str(exc) == "provider timeout"
    else:
        raise AssertionError("provider timeout must remain visible")

    assert failures == [{
        "claim_id": "claim-1",
        "claim_token": "worker-4",
        "outcome": "uncertain",
        "reason": "TimeoutError: provider timeout",
    }]
    assert resolutions[0]["outcome"] == "uncertain"


def test_executor_requeues_transient_veo_poll_failure_after_provider_identity_is_durable(monkeypatch):
    provider_records: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: _claim())
    monkeypatch.setattr(production_executor, "settings", lambda: SimpleNamespace(gcp_project="project-1", vertex_media_location="us-central1", media_output_bucket="media-bucket"))
    monkeypatch.setattr(production_executor, "GoogleMediaTransport", lambda **_kwargs: object())
    monkeypatch.setattr(production_executor, "reserve_budget", lambda _payload: None)
    monkeypatch.setattr(production_executor, "start_production_provider_submission", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(production_executor, "record_production_provider_operation", lambda *args, **kwargs: provider_records.append(kwargs))
    monkeypatch.setattr(production_executor, "record_production_operation_failure", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("resumable poll must not be failed")))

    def transient_poll(_self, *, persist_operation, **_kwargs):
        persist_operation("operations/veo-durable")
        raise MediaProviderError("HTTP 503")

    monkeypatch.setattr(production_executor.VeoGenerator, "generate", transient_poll)

    result = production_executor.execute_production_operation(
        "plan-1", _operation()["id"], claim_token="worker-transient",
    )

    assert result == {"outcome": "waiting_provider", "providerOperationId": "operations/veo-durable"}
    assert len(provider_records) == 2


def test_executor_persists_budget_rejection_as_terminal_failure_before_provider(monkeypatch):
    failures: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: _claim())
    monkeypatch.setattr(production_executor, "settings", lambda: SimpleNamespace(gcp_project="project-1", vertex_media_location="us-central1", media_output_bucket="media-bucket"))
    monkeypatch.setattr(production_executor, "reserve_budget", lambda _payload: (_ for _ in ()).throw(WebApiError("budget rejected", 409)))
    monkeypatch.setattr(production_executor, "record_production_operation_failure", lambda *args, **kwargs: failures.append(kwargs) or {"state": "failed"})
    monkeypatch.setattr(production_executor, "GoogleMediaTransport", lambda **_kwargs: (_ for _ in ()).throw(AssertionError("provider must not run")))

    result = production_executor.execute_production_operation(
        "plan-1", _operation()["id"], claim_token="worker-budget-rejected",
    )

    assert result == {"outcome": "failed", "reason": "budget authorization rejected"}
    assert failures == [{
        "claim_id": "claim-1",
        "claim_token": "worker-budget-rejected",
        "outcome": "failed",
        "reason": "budget authorization rejected: WebApiError",
    }]


def test_executor_fails_closed_before_budget_when_veo_output_bucket_is_missing(monkeypatch):
    failures: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: _claim())
    monkeypatch.setattr(production_executor, "settings", lambda: SimpleNamespace(
        gcp_project="project-1", vertex_media_location="us-central1", media_output_bucket=None,
    ))
    monkeypatch.setattr(
        production_executor, "reserve_budget",
        lambda _payload: (_ for _ in ()).throw(AssertionError("missing output storage must fail before budget")),
    )
    monkeypatch.setattr(
        production_executor, "start_production_provider_submission",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("provider submission must not be armed")),
    )
    monkeypatch.setattr(
        production_executor, "record_production_operation_failure",
        lambda *args, **kwargs: failures.append(kwargs) or {"state": "failed"},
    )

    result = production_executor.execute_production_operation(
        "plan-1", _operation()["id"], claim_token="worker-no-bucket",
    )

    assert result == {"outcome": "failed", "reason": "authorized Veo output storage unavailable"}
    assert failures == [{
        "claim_id": "claim-1",
        "claim_token": "worker-no-bucket",
        "outcome": "failed",
        "reason": "MEDIA_OUTPUT_BUCKET is required for authorized Veo output",
    }]


def test_executor_releases_budget_when_predispatch_authorization_is_revoked(monkeypatch):
    failures: list[dict] = []
    resolutions: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: _claim())
    monkeypatch.setattr(production_executor, "settings", lambda: SimpleNamespace(gcp_project="project-1", vertex_media_location="us-central1", media_output_bucket="media-bucket"))
    monkeypatch.setattr(production_executor, "reserve_budget", lambda _payload: None)
    monkeypatch.setattr(production_executor, "start_production_provider_submission", lambda *_args, **_kwargs: (_ for _ in ()).throw(WebApiError("revision superseded", 409)))
    monkeypatch.setattr(production_executor, "record_production_operation_failure", lambda *args, **kwargs: failures.append(kwargs) or {"state": "failed"})
    monkeypatch.setattr(production_executor, "resolve_budget_reservation", resolutions.append)
    monkeypatch.setattr(production_executor, "GoogleMediaTransport", lambda **_kwargs: (_ for _ in ()).throw(AssertionError("provider must not run")))

    result = production_executor.execute_production_operation(
        "plan-1", _operation()["id"], claim_token="worker-revoked",
    )

    assert result == {"outcome": "failed", "reason": "provider submission authorization failed"}
    assert failures[0]["outcome"] == "failed"
    assert resolutions == [{
        "jobId": "job-1",
        "operationId": "production:claim-1",
        "outcome": "not_invoked",
        "reason": "provider submission authorization failed before provider invocation",
    }]


def test_executor_surfaces_failed_veo_poll_rearm_for_pubsub_retry(monkeypatch):
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: _claim(provider_operation_id="operations/existing"))
    monkeypatch.setattr(production_executor, "settings", lambda: SimpleNamespace(gcp_project="project-1", vertex_media_location="us-central1", media_output_bucket="media-bucket"))
    monkeypatch.setattr(production_executor, "GoogleMediaTransport", lambda **_kwargs: object())
    monkeypatch.setattr(production_executor, "reserve_budget", lambda _payload: None)
    monkeypatch.setattr(production_executor.VeoGenerator, "generate", lambda *_args, **_kwargs: (_ for _ in ()).throw(MediaProviderError("poll unavailable")))
    monkeypatch.setattr(production_executor, "record_production_provider_operation", lambda *_args, **_kwargs: (_ for _ in ()).throw(WebApiError("re-arm unavailable", 503)))
    monkeypatch.setattr(production_executor, "record_production_operation_failure", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("transient persisted poll must not be terminal")))

    try:
        production_executor.execute_production_operation(
            "plan-1", _operation()["id"], claim_token="worker-rearm-failure",
        )
    except WebApiError as exc:
        assert exc.status == 503
    else:
        raise AssertionError("failed durable re-arm must remain retryable")


def test_internal_resolve_media_materializes_only_the_sealed_source_claim(monkeypatch):
    operation_id = "plan-1:resolve_media:018f47a2-4f40-7b1f-b19f-8f6b916b7d11"
    reference = {
        "artifactId": "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
        "digest": "a" * 64,
        "mime": "video/mp4",
        "sizeBytes": 21,
        "rightsAuthorizationId": "license-source-1",
    }
    decision = {
        "outcome": "execute",
        "claim": {
            "kind": "internal", "id": "resolve-claim", "operationId": operation_id,
            "planDigest": "f" * 64, "inputDigests": [],
        },
        "operation": {
            "id": operation_id, "type": "resolve_media", "executionAuthority": "internal",
            "payload": reference,
        },
        "plan": {"id": "plan-1", "jobId": "job-1"},
        "inputs": [],
    }
    uploads: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: decision)
    monkeypatch.setattr(
        production_executor,
        "download_production_source",
        lambda *args, **kwargs: (b"verified-source-video", "video/mp4", "a" * 64),
        raising=False,
    )
    monkeypatch.setattr(
        production_executor,
        "inspect_generated_media_bytes",
        lambda data, mime: {"durationSec": 4.0, "video": {"codec": "h264"}},
    )
    monkeypatch.setattr(
        production_executor,
        "upload_production_artifact",
        lambda *args, **kwargs: uploads.append(kwargs) or {"state": "succeeded"},
    )

    result = production_executor.execute_production_operation(
        "plan-1", operation_id, claim_token="resolve-worker",
    )

    assert result == {"outcome": "succeeded", "claim": {"state": "succeeded"}}
    assert uploads[0]["data"] == b"verified-source-video"
    assert uploads[0]["operation_metadata"] == {
        "kind": "verified_source_materialization",
        "artifactId": reference["artifactId"],
        "artifactDigest": reference["digest"],
        "rightsAuthorizationId": "license-source-1",
        "inspection": {"durationSec": 4.0, "video": {"codec": "h264"}},
    }


def test_internal_resolve_media_accepts_a_real_decodable_conditioning_image(monkeypatch, tmp_path: Path):
    image_path = tmp_path / "conditioning.png"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i",
        "color=c=blue:s=640x360", "-frames:v", "1", str(image_path),
    ], check=True)
    data = image_path.read_bytes()
    digest = hashlib.sha256(data).hexdigest()
    artifact_id = "018f47a2-4f40-7b1f-b19f-8f6b916b7d13"
    operation_id = f"plan-1:resolve_media:{artifact_id}"
    decision = {
        "outcome": "execute",
        "claim": {
            "kind": "internal", "id": "resolve-image-claim", "operationId": operation_id,
            "planDigest": "f" * 64, "inputDigests": [],
        },
        "operation": {
            "id": operation_id, "type": "resolve_media", "executionAuthority": "internal",
            "payload": {
                "artifactId": artifact_id, "digest": digest, "mime": "image/png",
                "sizeBytes": len(data), "rightsAuthorizationId": "license-conditioning-1",
            },
        },
        "plan": {"id": "plan-1", "jobId": "job-1"},
        "inputs": [],
    }
    uploads: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: decision)
    monkeypatch.setattr(
        production_executor, "download_production_source",
        lambda *args, **kwargs: (data, "image/png", digest), raising=False,
    )
    monkeypatch.setattr(
        production_executor, "upload_production_artifact",
        lambda *args, **kwargs: uploads.append(kwargs) or {"state": "succeeded"},
    )

    result = production_executor.execute_production_operation(
        "plan-1", operation_id, claim_token="resolve-image-worker",
    )

    assert result == {"outcome": "succeeded", "claim": {"state": "succeeded"}}
    assert uploads[0]["mime"] == "image/png"
    assert uploads[0]["operation_metadata"]["inspection"]["video"] == {
        "codec": "png", "width": 640, "height": 360, "frameRate": 25.0,
    }


def test_internal_resolve_media_rejects_malformed_bytes_declared_as_video(monkeypatch):
    data = b"not-an-mp4"
    digest = hashlib.sha256(data).hexdigest()
    operation_id = "plan-1:resolve_media:018f47a2-4f40-7b1f-b19f-8f6b916b7d11"
    decision = {
        "outcome": "execute",
        "claim": {
            "kind": "internal", "id": "resolve-bad-claim", "operationId": operation_id,
            "planDigest": "f" * 64, "inputDigests": [],
        },
        "operation": {
            "id": operation_id, "type": "resolve_media", "executionAuthority": "internal",
            "payload": {
                "artifactId": "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
                "digest": digest, "mime": "video/mp4", "sizeBytes": len(data),
                "rightsAuthorizationId": "license-source-1",
            },
        },
        "plan": {"id": "plan-1", "jobId": "job-1"},
        "inputs": [],
    }
    failures: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: decision)
    monkeypatch.setattr(
        production_executor, "download_production_source",
        lambda *args, **kwargs: (data, "video/mp4", digest), raising=False,
    )
    monkeypatch.setattr(
        production_executor, "inspect_generated_media_bytes",
        lambda *_args: (_ for _ in ()).throw(production_executor.MediaInspectionError("invalid media")),
    )
    monkeypatch.setattr(
        production_executor, "upload_production_artifact",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("invalid media must not upload")),
    )
    monkeypatch.setattr(
        production_executor, "record_production_operation_failure",
        lambda *args, **kwargs: failures.append(kwargs),
    )

    try:
        production_executor.execute_production_operation(
            "plan-1", operation_id, claim_token="resolve-bad-worker",
        )
    except production_executor.MediaInspectionError as exc:
        assert str(exc) == "invalid media"
    else:
        raise AssertionError("malformed declared media must fail closed")

    assert failures == [{
        "claim_id": "resolve-bad-claim",
        "claim_token": "resolve-bad-worker",
        "outcome": "failed",
        "reason": "MediaInspectionError: invalid media",
    }]


def test_internal_build_composes_verified_source_and_narration_with_voiceover_carve(monkeypatch, tmp_path: Path):
    source_artifact_id = "018f47a2-4f40-7b1f-b19f-8f6b916b7d11"
    narration_artifact_id = "018f47a2-4f40-7b1f-b19f-8f6b916b7d12"
    source_operation_id = f"plan-1:resolve_media:{source_artifact_id}"
    narration_operation_id = f"plan-1:resolve_media:{narration_artifact_id}"
    operation_id = "plan-1:build_composition"
    decision = {
        "outcome": "execute",
        "claim": {
            "kind": "internal", "id": "build-source-claim", "operationId": operation_id,
            "planDigest": "f" * 64,
            "inputDigests": [
                {"operationId": source_operation_id, "digest": "a" * 64},
                {"operationId": narration_operation_id, "digest": "b" * 64},
                {"operationId": "plan-1:generate_music", "digest": "c" * 64},
            ],
        },
        "operation": {
            "id": operation_id, "type": "build_composition", "executionAuthority": "internal",
        },
        "plan": {
            "id": "plan-1", "jobId": "job-1",
            "target": {"durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p", "frameRate": 30},
            "scenes": [{
                "id": "scene-1", "order": 1, "startSec": 0, "durationSec": 4,
                "purpose": "Operator footage",
                "sourceWindow": {"startSec": 88.25, "durationSec": 4},
                "sourceSegmentRefs": ["segment-1"],
                "preserveSourceAudio": True,
                "reframe": {"xPercent": 48, "yPercent": 42, "scale": 1.3},
                "captions": [{
                    "id": "caption-1", "startSec": 0.5, "durationSec": 2,
                    "text": "Evidence-bound source speech.",
                    "sourceSegmentRefs": ["segment-1"],
                }],
                "sourceArtifact": {
                    "artifactId": source_artifact_id, "digest": "a" * 64,
                    "mime": "video/mp4", "sizeBytes": 20,
                    "rightsAuthorizationId": "license-source-1",
                },
            }],
            "narration": [{
                "id": "voice-1", "startSec": 0.25, "durationSec": 3.5,
                "artifact": {
                    "artifactId": narration_artifact_id, "digest": "b" * 64,
                    "mime": "audio/wav", "sizeBytes": 21,
                    "rightsAuthorizationId": "license-narration-1",
                },
            }],
        },
        "inputs": [
            {"operationId": source_operation_id, "artifact": {"mime": "video/mp4", "digest": "a" * 64}},
            {"operationId": narration_operation_id, "artifact": {"mime": "audio/wav", "digest": "b" * 64}},
            {"operationId": "plan-1:generate_music", "artifact": {"mime": "audio/mpeg", "digest": "c" * 64}},
        ],
    }
    uploads: list[dict] = []
    downloaded = {
        source_operation_id: (b"verified-source-video", "video/mp4", "a" * 64),
        narration_operation_id: (b"verified-narration-wav", "audio/wav", "b" * 64),
        "plan-1:generate_music": (b"verified-lyria-music", "audio/mpeg", "c" * 64),
    }
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: decision)
    monkeypatch.setattr(production_executor, "download_production_artifact", lambda _plan, op: downloaded[op])
    monkeypatch.setattr(production_executor, "upload_production_artifact", lambda *args, **kwargs: uploads.append(kwargs) or {"state": "succeeded"})
    monkeypatch.setattr(production_executor.subprocess, "run", lambda *_args, **_kwargs: SimpleNamespace(stdout="0.8.20\n"))

    result = production_executor.execute_production_operation(
        "plan-1", operation_id, claim_token="build-source-worker",
    )

    assert result == {"outcome": "succeeded", "claim": {"state": "succeeded"}}
    extracted = tmp_path / "source-composition"
    production_executor.extract_verified_archive(uploads[0]["data"], extracted)
    manifest = json.loads((extracted / "composition-manifest.json").read_text())
    html = (extracted / "index.html").read_text()
    assert manifest["voiceoverCarve"] == {
        "enabled": True, "sources": ["voiceover"], "strength": 0.25, "dynamic": True,
    }
    assert 'data-audio-group="voiceover"' in html
    assert 'data-media-start="88.25"' in html
    assert 'object-position:48% 42%;transform:scale(1.3)' in html
    assert "Evidence-bound source speech." in html
    source_video = html.split('id="hf-plan-1-scene-1-video"', 1)[1].split("</video>", 1)[0]
    assert " muted" not in source_video
    assert (extracted / "assets" / f"{'a' * 64}.mp4").read_bytes() == b"verified-source-video"
    assert (extracted / "assets" / f"{'b' * 64}.wav").read_bytes() == b"verified-narration-wav"


def test_internal_build_compiles_verified_inputs_to_a_durable_composition_archive(monkeypatch, tmp_path: Path):
    operation_id = "plan-1:build_composition"
    video_operation_id = _operation()["id"]
    decision = {
        "outcome": "execute",
        "claim": {
            "kind": "internal", "id": "internal-claim", "planId": "plan-1",
            "planDigest": "f" * 64, "operationId": operation_id,
            "inputDigests": [{"operationId": video_operation_id, "digest": "e" * 64}],
        },
        "operation": {
            "id": operation_id, "type": "build_composition", "executionAuthority": "internal",
        },
        "plan": {
            "id": "plan-1",
            "target": {"durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p", "frameRate": 30},
            "scenes": [{
                "id": "scene-1", "order": 1, "startSec": 0, "durationSec": 4,
                "purpose": "Launch", "video": _operation()["payload"],
            }],
        },
        "inputs": [{
            "operationId": video_operation_id,
            "artifact": {"mime": "video/mp4", "digest": "e" * 64},
        }],
    }
    uploads: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: decision)
    monkeypatch.setattr(production_executor, "download_production_artifact", lambda *_args: (b"verified-video", "video/mp4", "e" * 64))
    monkeypatch.setattr(production_executor, "upload_production_artifact", lambda *args, **kwargs: uploads.append(kwargs) or {"state": "succeeded"})
    monkeypatch.setattr(production_executor.subprocess, "run", lambda *_args, **_kwargs: SimpleNamespace(stdout="0.8.20\n"))

    result = production_executor.execute_production_operation(
        "plan-1", operation_id, claim_token="internal-worker",
    )

    assert result == {"outcome": "succeeded", "claim": {"state": "succeeded"}}
    assert uploads[0]["mime"] == "application/zip"
    extracted = tmp_path / "composition"
    production_executor.extract_verified_archive(uploads[0]["data"], extracted)
    manifest = json.loads((extracted / "composition-manifest.json").read_text())
    assert manifest["hyperframesVersion"] == "0.8.20"
    assert manifest["inputDigests"] == decision["claim"]["inputDigests"]
    assert (extracted / "assets" / f"{'e' * 64}.mp4").read_bytes() == b"verified-video"


def test_internal_media_failure_is_persisted_as_terminal(monkeypatch):
    operation_id = "plan-1:render_composition"
    decision = {
        "outcome": "execute",
        "claim": {"kind": "internal", "id": "claim-internal", "operationId": operation_id},
        "operation": {"id": operation_id, "type": "render_composition", "executionAuthority": "internal"},
        "plan": {},
        "inputs": [],
    }
    failures: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: decision)
    monkeypatch.setattr(
        production_executor,
        "_execute_internal_operation",
        lambda *_args: (_ for _ in ()).throw(production_executor.MediaInspectionError("strict render failed")),
    )
    monkeypatch.setattr(
        production_executor,
        "record_production_operation_failure",
        lambda *args, **kwargs: failures.append(kwargs) or {"state": "failed"},
    )

    try:
        production_executor.execute_production_operation(
            "plan-1", operation_id, claim_token="worker-internal",
        )
    except production_executor.MediaInspectionError as exc:
        assert str(exc) == "strict render failed"
    else:
        raise AssertionError("deterministic media failure must remain visible")

    assert failures == [{
        "claim_id": "claim-internal",
        "claim_token": "worker-internal",
        "outcome": "failed",
        "reason": "MediaInspectionError: strict render failed",
    }]


def test_internal_repair_consumes_sealed_final_and_qa_inputs_once(monkeypatch):
    operation_id = "plan-1:repair_media"
    final_id = "plan-1:ffmpeg_finalize"
    qa_id = "plan-1:evaluate_production"
    qa = {"passed": False, "issues": ["integrated_loudness_out_of_range"]}
    decision = {
        "outcome": "execute",
        "claim": {
            "kind": "internal", "id": "repair-claim", "operationId": operation_id,
            "planDigest": "f" * 64,
            "inputDigests": [
                {"operationId": final_id, "digest": "a" * 64},
                {"operationId": qa_id, "digest": "b" * 64},
            ],
        },
        "operation": {"id": operation_id, "type": "repair_media", "executionAuthority": "internal"},
        "plan": {"target": {"durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p", "frameRate": 30}},
        "inputs": [
            {"operationId": final_id, "artifact": {"mime": "video/mp4", "digest": "a" * 64}},
            {"operationId": qa_id, "artifact": {"mime": "application/json", "digest": "b" * 64}},
        ],
    }
    uploads: list[dict] = []
    repairs: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: decision)
    monkeypatch.setattr(
        production_executor,
        "download_production_artifact",
        lambda _plan, operation: (b"final-video", "video/mp4", "a" * 64)
        if operation == final_id else (json.dumps(qa).encode(), "application/json", "b" * 64),
    )

    def repair(source, output, *, target, issues):
        repairs.append({"source": source.read_bytes(), "target": target, "issues": issues})
        output.write_bytes(b"repaired-video")
        return output, {"attempt": 1, "qa": {"passed": True}}

    monkeypatch.setattr(production_executor, "repair_media_artifact", repair)
    monkeypatch.setattr(production_executor, "inspect_media", lambda _path: {"video": {"codec": "h264"}})
    monkeypatch.setattr(
        production_executor, "upload_production_artifact",
        lambda *args, **kwargs: uploads.append(kwargs) or {"state": "succeeded"},
    )

    result = production_executor.execute_production_operation(
        "plan-1", operation_id, claim_token="repair-worker",
    )

    assert result["outcome"] == "succeeded"
    assert repairs == [{
        "source": b"final-video",
        "target": {"durationSec": 4, "width": 1080, "height": 1920, "frameRate": 30},
        "issues": ["integrated_loudness_out_of_range"],
    }]
    assert uploads[0]["data"] == b"repaired-video"
    assert uploads[0]["operation_metadata"]["receipt"]["attempt"] == 1


def test_internal_export_contains_verified_video_qa_and_previews(monkeypatch, tmp_path: Path):
    import subprocess

    video = tmp_path / "final.mp4"
    subprocess.run([
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-f", "lavfi", "-i", "testsrc2=s=320x240:r=24:d=1",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", str(video),
    ], check=True)
    video_bytes = video.read_bytes()
    video_digest = production_executor.hashlib.sha256(video_bytes).hexdigest()
    qa_bytes = b'{"passed":true,"issues":[]}'
    qa_digest = production_executor.hashlib.sha256(qa_bytes).hexdigest()
    operation_id = "plan-1:assemble_export"
    final_id = "plan-1:repair_media"
    qa_id = "plan-1:evaluate_delivery"
    decision = {
        "outcome": "execute",
        "claim": {
            "kind": "internal", "id": "export-claim", "operationId": operation_id,
            "planDigest": "f" * 64,
            "inputDigests": [
                {"operationId": final_id, "digest": video_digest},
                {"operationId": qa_id, "digest": qa_digest},
            ],
        },
        "operation": {"id": operation_id, "type": "assemble_export", "executionAuthority": "internal"},
        "plan": {},
        "inputs": [
            {"operationId": final_id, "artifact": {"mime": "video/mp4", "digest": video_digest}},
            {"operationId": qa_id, "artifact": {"mime": "application/json", "digest": qa_digest}},
        ],
    }
    uploads: list[dict] = []
    monkeypatch.setattr(production_executor, "claim_production_operation", lambda *_args: decision)
    monkeypatch.setattr(
        production_executor, "download_production_artifact",
        lambda _plan, operation: (video_bytes, "video/mp4", video_digest)
        if operation == final_id else (qa_bytes, "application/json", qa_digest),
    )
    monkeypatch.setattr(
        production_executor, "upload_production_artifact",
        lambda *args, **kwargs: uploads.append(kwargs) or {"state": "succeeded"},
    )

    production_executor.execute_production_operation(
        "plan-1", operation_id, claim_token="export-worker",
    )

    extracted = tmp_path / "export"
    names = production_executor.extract_verified_archive(uploads[0]["data"], extracted)
    assert names == ["contact-sheet.jpg", "export-receipt.json", "final.mp4", "qa.json", "thumbnail.jpg"]
    assert (extracted / "final.mp4").read_bytes() == video_bytes
    assert (extracted / "thumbnail.jpg").read_bytes().startswith(b"\xff\xd8\xff")
