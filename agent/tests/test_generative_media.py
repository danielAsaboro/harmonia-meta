"""Veo/Lyria provider contracts, resumption, and failure semantics."""

from __future__ import annotations

import json
import pytest

from harmonia_agent.generative_media import (
    GoogleMediaTransport,
    LyriaGenerator,
    MediaOperationPending,
    MediaProtocolError,
    VeoGenerator,
    estimate_media_cost,
    validate_lyria_request,
    validate_veo_request,
)
from harmonia_agent.stages import classify_failure


class FakeTransport:
    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.veo_done = True

    def start_veo(self, **kwargs):
        self.calls.append(("start", kwargs))
        return {"name": "projects/p/locations/us-central1/models/veo/operations/op-1"}

    def poll_veo(self, operation_name: str, model: str):
        self.calls.append(("poll", operation_name, model))
        if not self.veo_done:
            return {"name": operation_name, "done": False}
        return {"name": operation_name, "done": True, "response": {"videos": [{
            "bytesBase64Encoded": "dmlkZW8=", "mimeType": "video/mp4",
        }]}}

    def generate_lyria(self, **kwargs):
        self.calls.append(("lyria", kwargs))
        return {"id": "interaction-1", "status": "completed", "outputs": [{
            "type": "audio", "mime_type": "audio/mpeg", "data": "YXVkaW8=",
        }]}

    def download_gcs(self, uri: str, authorized_prefix: str) -> bytes:
        self.calls.append(("download", uri, authorized_prefix))
        return b"video-from-gcs"


def test_veo_persists_operation_before_polling_and_returns_typed_media():
    transport = FakeTransport()
    order: list[str] = []

    result = VeoGenerator(transport=transport).generate(
        request=validate_veo_request({"modelCapability": "veo-3.1-fast", "mode": "text_to_video", "prompt": "abstract startup dashboard motion", "durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p", "generateAudio": False, "enhancePrompt": True, "outputCount": 1}),
        existing_operation=None,
        persist_operation=lambda name: order.append(f"persist:{name}"),
    )

    assert result.data == b"video"
    assert result.mime == "video/mp4"
    assert result.model == "veo-3.1-fast-generate-001"
    assert order == ["persist:projects/p/locations/us-central1/models/veo/operations/op-1"]
    assert [call[0] for call in transport.calls] == ["start", "poll"]
    assert transport.calls[1][2] == "veo-3.1-fast-generate-001"


def test_veo_materializes_sealed_first_and_last_frames_into_the_official_rest_instance():
    first = {
        "artifactId": "018f47a2-4f40-7b1f-b19f-8f6b916b7d13",
        "digest": "3" * 64,
        "mime": "image/png",
        "sizeBytes": 5,
        "rightsAuthorizationId": "license-first",
    }
    last = {
        "artifactId": "018f47a2-4f40-7b1f-b19f-8f6b916b7d14",
        "digest": "4" * 64,
        "mime": "image/jpeg",
        "sizeBytes": 4,
        "rightsAuthorizationId": "license-last",
    }
    request = validate_veo_request({
        "modelCapability": "veo-3.1-fast", "mode": "first_last_frame",
        "prompt": "camera moves through the product interface", "durationSec": 4,
        "aspectRatio": "9:16", "resolution": "1080p", "generateAudio": False,
        "enhancePrompt": True, "outputCount": 1,
        "sourceImageArtifact": first, "lastFrameArtifact": last,
    })
    transport = FakeTransport()

    VeoGenerator(transport=transport).generate(
        request=request,
        existing_operation=None,
        persist_operation=lambda _name: None,
        conditioning_media={
            first["artifactId"]: (b"first", "image/png", first["digest"]),
            last["artifactId"]: (b"last", "image/jpeg", last["digest"]),
        },
    )

    started = transport.calls[0][1]
    assert started["source_image"] == {
        "bytesBase64Encoded": "Zmlyc3Q=", "mimeType": "image/png",
    }
    assert started["last_frame"] == {
        "bytesBase64Encoded": "bGFzdA==", "mimeType": "image/jpeg",
    }

    captured: list[dict] = []
    vertex = GoogleMediaTransport(project="project-1", location="us-central1")
    vertex._post = lambda _url, body, timeout: captured.append(body) or {"name": "operations/1"}  # type: ignore[method-assign]
    vertex.start_veo(
        model="veo-3.1-fast-generate-001", prompt="validated prompt", duration_sec=4,
        aspect_ratio="9:16", resolution="1080p", generate_audio=False,
        enhance_prompt=True, seed=None, storage_uri="gs://bucket/output/",
        source_image=started["source_image"], last_frame=started["last_frame"],
    )
    assert captured[0]["instances"] == [{
        "prompt": "validated prompt",
        "image": {"bytesBase64Encoded": "Zmlyc3Q=", "mimeType": "image/png"},
        "lastFrame": {"bytesBase64Encoded": "bGFzdA==", "mimeType": "image/jpeg"},
    }]


def test_veo_rejects_conditioning_bytes_that_do_not_match_the_sealed_identity():
    reference = {
        "artifactId": "018f47a2-4f40-7b1f-b19f-8f6b916b7d13",
        "digest": "3" * 64,
        "mime": "image/png",
        "sizeBytes": 5,
        "rightsAuthorizationId": "license-first",
    }
    request = validate_veo_request({
        "modelCapability": "veo-3.1-fast", "mode": "image_to_video", "prompt": "move",
        "durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p",
        "generateAudio": False, "enhancePrompt": True, "outputCount": 1,
        "sourceImageArtifact": reference,
    })
    with pytest.raises(MediaProtocolError, match="sealed identity"):
        VeoGenerator(transport=FakeTransport()).generate(
            request=request,
            existing_operation=None,
            persist_operation=lambda _name: None,
            conditioning_media={reference["artifactId"]: (b"wrong", "image/jpeg", "5" * 64)},
        )


def test_veo_rejects_conditioning_images_above_the_provider_limit():
    reference = {
        "artifactId": "018f47a2-4f40-7b1f-b19f-8f6b916b7d13",
        "digest": "3" * 64,
        "mime": "image/png",
        "sizeBytes": 20 * 1024 * 1024 + 1,
        "rightsAuthorizationId": "license-first",
    }
    with pytest.raises(MediaProtocolError, match="malformed|size"):
        validate_veo_request({
            "modelCapability": "veo-3.1-fast", "mode": "image_to_video", "prompt": "move",
            "durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p",
            "generateAudio": False, "enhancePrompt": True, "outputCount": 1,
            "sourceImageArtifact": reference,
        })


def test_veo_uses_only_its_authorized_gcs_output_prefix_and_retains_filtering_metadata():
    class GcsTransport(FakeTransport):
        def poll_veo(self, operation_name: str, model: str):
            self.calls.append(("poll", operation_name, model))
            return {
                "name": operation_name,
                "done": True,
                "response": {
                    "raiMediaFilteredCount": 0,
                    "raiMediaFilteredReasons": [],
                    "usageMetadata": {"generatedVideoCount": 1, "billedDurationSeconds": 4},
                    "modelStatus": "GA",
                    "costMetadata": {"currency": "USD", "billedUnits": 4},
                    "videos": [{
                        "gcsUri": "gs://media-bucket/workspaces/w1/brands/b1/jobs/j1/plans/p1/claims/c1/123/sample_0.mp4",
                        "mimeType": "video/mp4",
                        "watermark": {"type": "SynthID", "embedded": True},
                        "c2pa": {"manifestId": "manifest-1"},
                        "bytesBase64Encoded": "must-not-be-persisted",
                    }],
                    "prompt": "must-not-be-persisted",
                },
            }

    transport = GcsTransport()
    prefix = "gs://media-bucket/workspaces/w1/brands/b1/jobs/j1/plans/p1/claims/c1/"
    result = VeoGenerator(transport=transport).generate(
        request=validate_veo_request({"modelCapability": "veo-3.1-fast", "mode": "text_to_video", "prompt": "abstract startup dashboard motion", "durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p", "generateAudio": False, "enhancePrompt": True, "outputCount": 1}),
        existing_operation=None,
        persist_operation=lambda _name: None,
        authorized_output_prefix=prefix,
    )

    assert transport.calls[0][1]["storage_uri"] == prefix
    assert transport.calls[-1] == (
        "download",
        "gs://media-bucket/workspaces/w1/brands/b1/jobs/j1/plans/p1/claims/c1/123/sample_0.mp4",
        prefix,
    )
    assert result.data == b"video-from-gcs"
    assert result.provider_metadata == {
        "gcsUri": "gs://media-bucket/workspaces/w1/brands/b1/jobs/j1/plans/p1/claims/c1/123/sample_0.mp4",
        "raiMediaFilteredCount": 0,
        "raiMediaFilteredReasons": [],
        "usageMetadata": {"generatedVideoCount": 1, "billedDurationSeconds": 4},
        "modelStatus": "GA",
        "costMetadata": {"currency": "USD", "billedUnits": 4},
        "watermark": {"type": "SynthID", "embedded": True},
        "c2pa": {"manifestId": "manifest-1"},
    }


def test_veo_rejects_a_completed_output_outside_its_authorized_prefix():
    class EscapedTransport(FakeTransport):
        def poll_veo(self, operation_name: str, model: str):
            return {"done": True, "response": {"videos": [{
                "gcsUri": "gs://media-bucket/another-job/sample_0.mp4", "mimeType": "video/mp4",
            }]}}

        def download_gcs(self, uri: str, authorized_prefix: str) -> bytes:
            pytest.fail("out-of-prefix media must not be downloaded")

    with pytest.raises(MediaProtocolError, match="authorized GCS prefix"):
        VeoGenerator(transport=EscapedTransport()).generate(
            request=validate_veo_request({"modelCapability": "veo-3.1-fast", "mode": "text_to_video", "prompt": "abstract startup dashboard motion", "durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p", "generateAudio": False, "enhancePrompt": True, "outputCount": 1}),
            existing_operation="operations/op-1",
            persist_operation=lambda _name: None,
            authorized_output_prefix="gs://media-bucket/workspaces/w1/brands/b1/jobs/j1/plans/p1/claims/c1/",
        )


def test_veo_rejects_inline_bytes_when_gcs_output_was_required():
    with pytest.raises(MediaProtocolError, match="GCS output URI"):
        VeoGenerator(transport=FakeTransport()).generate(
            request=validate_veo_request({"modelCapability": "veo-3.1-fast", "mode": "text_to_video", "prompt": "abstract startup dashboard motion", "durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p", "generateAudio": False, "enhancePrompt": True, "outputCount": 1}),
            existing_operation="operations/op-1",
            persist_operation=lambda _name: None,
            authorized_output_prefix="gs://media-bucket/workspaces/w1/brands/b1/jobs/j1/plans/p1/claims/c1/",
        )


def test_veo_resumes_existing_operation_without_starting_a_duplicate():
    transport = FakeTransport()
    transport.veo_done = False
    with pytest.raises(MediaOperationPending, match="op-1"):
        VeoGenerator(transport=transport).generate(
            request=validate_veo_request({"modelCapability": "veo-3.1-fast", "mode": "text_to_video", "prompt": "abstract startup dashboard motion", "durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p", "generateAudio": False, "enhancePrompt": True, "outputCount": 1}),
            existing_operation="operations/op-1",
            persist_operation=lambda _: pytest.fail("must not persist twice"),
        )
    assert transport.calls == [("poll", "operations/op-1", "veo-3.1-fast-generate-001")]


def test_lyria_returns_one_bounded_audio_clip_and_provider_interaction_id():
    class ProvenanceTransport(FakeTransport):
        def generate_lyria(self, **kwargs):
            return {
                "id": "interaction-1", "object": "interaction", "status": "completed",
                "role": "model", "model": "lyria-3-clip-preview",
                "created": "2026-08-31T10:00:00Z", "updated": "2026-08-31T10:00:12Z",
                "usage": {"generated_audio_seconds": 30},
                "release_status": "preview",
                "cost_metadata": {"currency": "USD", "billedGenerations": 1},
                "watermark": {"type": "SynthID", "embedded": True},
                "outputs": [
                    {"type": "text", "text": "These are generated lyrics"},
                    {"type": "text", "text": "Warm electronic instrumental description"},
                    {"type": "audio", "mime_type": "audio/mpeg", "data": "YXVkaW8=", "c2pa": {"manifestId": "music-1"}},
                ],
                "input": "must-not-be-persisted",
            }

    result = LyriaGenerator(transport=ProvenanceTransport()).generate(
        request=validate_lyria_request({"modelCapability": "lyria-3-clip", "prompt": "instrumental optimistic technology pulse", "instrumental": True, "lyricsMode": "none", "language": "en", "targetDurationSec": 30, "outputCount": 1}),
        estimated_cost_usd="0.120000",
    )
    assert result.data == b"audio"
    assert result.mime == "audio/mpeg"
    assert result.model == "lyria-3-clip-preview"
    assert result.provider_id == "interaction-1"
    assert result.provider_metadata == {
        "object": "interaction", "status": "completed", "role": "model",
        "model": "lyria-3-clip-preview", "created": "2026-08-31T10:00:00Z",
        "updated": "2026-08-31T10:00:12Z",
        "usageMetadata": {"generated_audio_seconds": 30},
        "modelStatus": "preview",
        "costMetadata": {"currency": "USD", "billedGenerations": 1},
        "watermark": {"type": "SynthID", "embedded": True},
        "lyrics": "These are generated lyrics",
        "description": "Warm electronic instrumental description",
        "c2pa": {"manifestId": "music-1"},
    }


def test_media_generators_reject_malformed_success_without_fallback():
    class EmptyLyria(FakeTransport):
        def generate_lyria(self, **kwargs):
            return {"status": "completed", "outputs": []}

    with pytest.raises(MediaProtocolError, match="audio"):
        LyriaGenerator(transport=EmptyLyria()).generate(request=validate_lyria_request({"modelCapability": "lyria-3-clip", "prompt": "pulse", "instrumental": True, "lyricsMode": "none", "language": "en", "targetDurationSec": 30, "outputCount": 1}), estimated_cost_usd="0.120000")


def test_lyria_requires_a_unique_interaction_id_and_never_uses_the_object_type_as_identity():
    class MissingIdentity(FakeTransport):
        def generate_lyria(self, **kwargs):
            return {"object": "interaction", "status": "completed", "outputs": [{
                "type": "audio", "mime_type": "audio/mpeg", "data": "YXVkaW8=",
            }]}

    with pytest.raises(MediaProtocolError, match="interaction id"):
        LyriaGenerator(transport=MissingIdentity()).generate(
            request=validate_lyria_request({"modelCapability": "lyria-3-clip", "prompt": "pulse", "instrumental": True, "lyricsMode": "none", "language": "en", "targetDurationSec": 30, "outputCount": 1}),
            estimated_cost_usd="0.120000",
        )


def test_provider_provenance_is_globally_bounded_below_the_artifact_metadata_header_limit():
    class OversizedProvenance(FakeTransport):
        def generate_lyria(self, **kwargs):
            return {
                "id": "interaction-large", "object": "interaction", "status": "completed",
                "usage": {f"metric_{index}": "u" * 2000 for index in range(100)},
                "watermark": {"manifest": "w" * 20000},
                "outputs": [
                    {"type": "text", "text": "lyrics-" + "l" * 20000},
                    {"type": "text", "text": "description-" + "d" * 20000},
                    {"type": "audio", "mime_type": "audio/mpeg", "data": "YXVkaW8=", "c2pa": {"manifest": "c" * 20000}},
                ],
            }

    result = LyriaGenerator(transport=OversizedProvenance()).generate(
        request=validate_lyria_request({"modelCapability": "lyria-3-clip", "prompt": "pulse", "instrumental": True, "lyricsMode": "none", "language": "en", "targetDurationSec": 30, "outputCount": 1}),
        estimated_cost_usd="0.120000",
    )

    encoded = json.dumps(result.provider_metadata, separators=(",", ":")).encode()
    assert len(encoded) <= 3072
    assert result.provider_metadata["lyrics"].startswith("lyrics-")
    assert "data" not in encoded.decode()


def test_media_pending_is_retryable_but_malformed_output_is_permanent():
    assert classify_failure(MediaOperationPending("operations/op-1")) is False
    assert classify_failure(MediaProtocolError("bad media")) is True


def test_catalog_validates_provider_capabilities_before_spend():
    request = validate_veo_request({
        "modelCapability": "veo-3.1-fast", "mode": "text_to_video", "prompt": "blue network",
        "durationSec": 4, "aspectRatio": "9:16", "resolution": "1080p",
        "generateAudio": False, "enhancePrompt": True, "outputCount": 1,
    })
    assert estimate_media_cost(request) == "0.320000"
    with pytest.raises(MediaProtocolError, match="resolution"):
        validate_veo_request({**request, "resolution": "4k"})


def test_preview_lyria_requires_deployment_pricing_and_rejects_invalid_instrumental_lyrics():
    request = validate_lyria_request({
        "modelCapability": "lyria-3-clip", "prompt": "warm minimal pulse", "instrumental": True,
        "lyricsMode": "none", "language": "en", "targetDurationSec": 30, "outputCount": 1,
    })
    with pytest.raises(MediaProtocolError, match="pricing unavailable"):
        estimate_media_cost(request)
    assert estimate_media_cost(request, {"lyria-3-clip": "0.120000"}) == "0.120000"
    with pytest.raises(MediaProtocolError, match="lyrics"):
        validate_lyria_request({**request, "lyricsMode": "provided", "providedLyrics": "hello"})
    with pytest.raises(MediaProtocolError, match="30-second"):
        validate_lyria_request({**request, "targetDurationSec": 4})


def test_unwired_conditioning_and_music_controls_are_not_advertised_as_executable():
    base_video = {"modelCapability": "veo-3.1-fast", "prompt": "blue network", "durationSec": 6, "aspectRatio": "16:9", "resolution": "1080p", "generateAudio": True, "enhancePrompt": False, "outputCount": 1}
    with pytest.raises(MediaProtocolError, match="mode"):
        validate_veo_request({**base_video, "mode": "reference_images"})
    with pytest.raises(MediaProtocolError, match="mode"):
        validate_veo_request({**base_video, "mode": "extend_video"})
    with pytest.raises(MediaProtocolError, match="conditioning|controls"):
        validate_lyria_request({"modelCapability": "lyria-3-clip", "prompt": "pulse", "conditioningImageArtifactId": "image-1", "instrumental": True, "lyricsMode": "none", "language": "en", "targetDurationSec": 30, "outputCount": 1})
