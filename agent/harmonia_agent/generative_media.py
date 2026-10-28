"""Approval-gated Veo and Lyria provider adapters with resumable operations."""

from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from typing import Any, Callable, Protocol

import google.auth
from google.auth.transport.requests import Request
import httpx
from google.cloud import storage

from .telemetry import safe_attributes, tracer

VEO_MODEL = "veo-3.1-fast-generate-001"
LYRIA_MODEL = "lyria-3-clip-preview"

VEO_CAPABILITIES: dict[str, dict[str, Any]] = {
    "veo-3.1-fast": {"model": "veo-3.1-fast-generate-001", "durations": {4, 6, 8}, "resolutions": {"720p", "1080p"}, "modes": {"text_to_video", "image_to_video", "first_last_frame"}, "usdPerSecond": "0.080000"},
    "veo-3.1": {"model": "veo-3.1-generate-001", "durations": {4, 6, 8}, "resolutions": {"720p", "1080p", "4k"}, "modes": {"text_to_video", "image_to_video", "first_last_frame"}, "usdPerSecond": None},
}
LYRIA_CAPABILITIES: dict[str, dict[str, Any]] = {
    "lyria-3-clip": {"model": "lyria-3-clip-preview", "maximumDurationSec": 30, "imageConditioning": True, "vocals": True, "structure": True, "fixedCostUsd": None},
    "lyria-3-pro": {"model": "lyria-3-pro-preview", "maximumDurationSec": 184, "imageConditioning": True, "vocals": True, "structure": True, "fixedCostUsd": None},
    "lyria-2": {"model": "lyria-002", "maximumDurationSec": 30, "imageConditioning": False, "vocals": False, "structure": False, "fixedCostUsd": "0.060000"},
}


class MediaProtocolError(RuntimeError):
    """A media provider returned a malformed or policy-filtered success."""


class MediaProviderError(RuntimeError):
    """Transport/provider failure, with retry classification."""

    def __init__(self, message: str, *, permanent: bool = False) -> None:
        super().__init__(message)
        self.permanent = permanent


class MediaOperationPending(MediaProviderError):
    def __init__(self, operation_name: str) -> None:
        super().__init__(f"media operation is still pending: {operation_name}")
        self.operation_name = operation_name


def validate_veo_request(request: dict[str, Any]) -> dict[str, Any]:
    value = dict(request)
    allowed_fields = {
        "modelCapability", "mode", "prompt", "negativePrompt", "sourceImageArtifact",
        "lastFrameArtifact", "durationSec", "aspectRatio", "resolution", "generateAudio",
        "seed", "enhancePrompt", "outputCount", "providerModel", "mediaKind",
    }
    if set(value) - allowed_fields:
        raise MediaProtocolError("Veo request contains unsupported fields")
    capability_name = value.get("modelCapability")
    capability = VEO_CAPABILITIES.get(str(capability_name))
    if capability is None:
        raise MediaProtocolError("unsupported Veo model capability")
    if value.get("outputCount") != 1:
        raise MediaProtocolError("Veo outputCount must be exactly one")
    if value.get("durationSec") not in capability["durations"]:
        raise MediaProtocolError("duration is unsupported by the selected Veo model")
    if value.get("resolution") not in capability["resolutions"]:
        raise MediaProtocolError("resolution is unsupported by the selected Veo model")
    mode = value.get("mode")
    if mode not in capability["modes"]:
        raise MediaProtocolError("mode is unsupported by the selected Veo model")
    required = {
        "image_to_video": ("sourceImageArtifact",),
        "first_last_frame": ("sourceImageArtifact", "lastFrameArtifact"),
    }.get(str(mode), ())
    for field in required:
        if not value.get(field):
            raise MediaProtocolError(f"{field} is required for {mode}")
    source = value.get("sourceImageArtifact")
    last = value.get("lastFrameArtifact")
    if mode == "text_to_video" and (source or last):
        raise MediaProtocolError("text-to-video cannot include conditioning images")
    if mode != "first_last_frame" and last:
        raise MediaProtocolError("last frame requires first-last-frame mode")
    for reference in (source, last):
        if reference is not None:
            _validate_conditioning_reference(reference)
    if value.get("negativePrompt"):
        raise MediaProtocolError("negative prompt is unavailable")
    if value.get("aspectRatio") not in {"16:9", "9:16"}:
        raise MediaProtocolError("unsupported Veo aspect ratio")
    value["providerModel"] = capability["model"]
    value["mediaKind"] = "video"
    return value


def _validate_conditioning_reference(reference: Any) -> dict[str, Any]:
    if not isinstance(reference, dict):
        raise MediaProtocolError("Veo conditioning artifact reference is malformed")
    if set(reference) != {"artifactId", "digest", "mime", "sizeBytes", "rightsAuthorizationId"}:
        raise MediaProtocolError("Veo conditioning artifact reference is malformed")
    if (
        not isinstance(reference["artifactId"], str)
        or not re.fullmatch(r"[0-9a-fA-F-]{36}", reference["artifactId"])
        or not isinstance(reference["digest"], str)
        or not re.fullmatch(r"[a-f0-9]{64}", reference["digest"])
        or reference["mime"] not in {"image/jpeg", "image/png"}
        or not isinstance(reference["sizeBytes"], int)
        or not 1 <= reference["sizeBytes"] <= 20 * 1024 * 1024
        or not isinstance(reference["rightsAuthorizationId"], str)
        or not reference["rightsAuthorizationId"]
    ):
        raise MediaProtocolError("Veo conditioning artifact reference is malformed")
    return reference


def validate_lyria_request(request: dict[str, Any]) -> dict[str, Any]:
    value = dict(request)
    capability_name = value.get("modelCapability")
    capability = LYRIA_CAPABILITIES.get(str(capability_name))
    if capability is None:
        raise MediaProtocolError("unsupported Lyria model capability")
    if value.get("outputCount") != 1:
        raise MediaProtocolError("Lyria outputCount must be exactly one")
    if int(value.get("targetDurationSec") or 0) > capability["maximumDurationSec"]:
        raise MediaProtocolError("duration exceeds the selected Lyria model")
    if capability_name == "lyria-3-clip" and value.get("targetDurationSec") != 30:
        raise MediaProtocolError("Lyria 3 Clip always generates a 30-second provider output")
    if value.get("instrumental") and value.get("lyricsMode") != "none":
        raise MediaProtocolError("instrumental music cannot include lyrics")
    if value.get("lyricsMode") == "provided" and not value.get("providedLyrics"):
        raise MediaProtocolError("provided lyrics are required")
    if value.get("conditioningImageArtifactId") and not capability["imageConditioning"]:
        raise MediaProtocolError("image conditioning is unsupported")
    if not value.get("instrumental") and not capability["vocals"]:
        raise MediaProtocolError("vocals are unsupported")
    if (
        value.get("conditioningImageArtifactId")
        or not value.get("instrumental")
        or value.get("lyricsMode") != "none"
        or any(value.get(field) is not None for field in (
            "genre", "mood", "instrumentation", "bpm", "intensity", "structure", "seed",
        ))
    ):
        raise MediaProtocolError("advanced Lyria conditioning and music controls are unavailable")
    value["providerModel"] = capability["model"]
    value["mediaKind"] = "music"
    return value


def estimate_media_cost(request: dict[str, Any], overrides: dict[str, str] | None = None) -> str:
    capability_name = str(request.get("modelCapability") or "")
    configured = (overrides or {}).get(capability_name)
    if request.get("mediaKind") == "video":
        capability = VEO_CAPABILITIES[capability_name]
        configured = configured or capability["usdPerSecond"]
        if configured is None:
            raise MediaProtocolError(f"pricing unavailable for {capability_name}")
        amount = Decimal(configured) * Decimal(int(request["durationSec"]))
    else:
        capability = LYRIA_CAPABILITIES[capability_name]
        configured = configured or capability["fixedCostUsd"]
        if configured is None:
            raise MediaProtocolError(f"pricing unavailable for {capability_name}")
        try:
            amount = Decimal(configured)
        except InvalidOperation as exc:
            raise MediaProtocolError(f"invalid pricing for {capability_name}") from exc
    return f"{amount:.6f}"


@dataclass(frozen=True)
class GeneratedMedia:
    data: bytes
    mime: str
    model: str
    provider_id: str
    duration_sec: int
    estimated_cost_usd: str
    provider_metadata: dict[str, Any] = field(default_factory=dict)


class MediaTransport(Protocol):
    def start_veo(self, **kwargs: Any) -> dict[str, Any]: ...

    def poll_veo(self, operation_name: str, model: str) -> dict[str, Any]: ...

    def generate_lyria(self, **kwargs: Any) -> dict[str, Any]: ...

    def download_gcs(self, uri: str, authorized_prefix: str) -> bytes: ...


class GoogleMediaTransport:
    """Small authenticated REST transport matching the published Vertex media APIs."""

    def __init__(self, *, project: str, location: str = "us-central1") -> None:
        self.project = project
        self.location = location

    def _headers(self) -> dict[str, str]:
        credentials, _ = google.auth.default(
            scopes=("https://www.googleapis.com/auth/cloud-platform",)
        )
        credentials.refresh(Request())
        return {"Authorization": f"Bearer {credentials.token}"}

    def _post(self, url: str, body: dict[str, Any], *, timeout: float) -> dict[str, Any]:
        try:
            response = httpx.post(url, json=body, headers=self._headers(), timeout=timeout)
        except httpx.HTTPError as exc:
            raise MediaProviderError(f"media transport failed: {exc}") from exc
        if response.status_code >= 300:
            permanent = response.status_code < 500 and response.status_code != 429
            raise MediaProviderError(
                f"media provider returned HTTP {response.status_code}", permanent=permanent,
            )
        try:
            data = response.json()
        except ValueError as exc:
            raise MediaProtocolError("media provider returned malformed JSON") from exc
        if not isinstance(data, dict):
            raise MediaProtocolError("media provider returned a non-object response")
        return data

    def start_veo(self, **kwargs: Any) -> dict[str, Any]:
        model = kwargs["model"]
        url = (
            f"https://{self.location}-aiplatform.googleapis.com/v1/projects/{self.project}"
            f"/locations/{self.location}/publishers/google/models/{model}:predictLongRunning"
        )
        instance: dict[str, Any] = {"prompt": kwargs["prompt"]}
        if kwargs.get("source_image"):
            instance["image"] = kwargs["source_image"]
        if kwargs.get("last_frame"):
            instance["lastFrame"] = kwargs["last_frame"]
        return self._post(url, {
            "instances": [instance],
            "parameters": {
                "durationSeconds": kwargs["duration_sec"],
                "aspectRatio": kwargs["aspect_ratio"],
                "resolution": kwargs["resolution"],
                "sampleCount": 1,
                "generateAudio": kwargs["generate_audio"],
                "enhancePrompt": kwargs["enhance_prompt"],
                **({"seed": kwargs["seed"]} if kwargs.get("seed") is not None else {}),
                "personGeneration": "disallow",
                **({"storageUri": kwargs["storage_uri"]} if kwargs.get("storage_uri") else {}),
            },
        }, timeout=60)

    def poll_veo(self, operation_name: str, model: str) -> dict[str, Any]:
        url = (
            f"https://{self.location}-aiplatform.googleapis.com/v1/projects/{self.project}"
            f"/locations/{self.location}/publishers/google/models/{model}:fetchPredictOperation"
        )
        return self._post(url, {"operationName": operation_name}, timeout=60)

    def generate_lyria(self, **kwargs: Any) -> dict[str, Any]:
        url = (
            "https://aiplatform.googleapis.com/v1beta1/projects/"
            f"{self.project}/locations/global/interactions"
        )
        return self._post(url, {
            "model": kwargs["model"],
            "input": [{"type": "text", "text": kwargs["prompt"]}],
        }, timeout=180)

    def download_gcs(self, uri: str, authorized_prefix: str) -> bytes:
        if not uri.startswith(authorized_prefix):
            raise MediaProtocolError("Veo output is outside its authorized GCS prefix")
        remainder = uri.removeprefix("gs://")
        bucket, separator, object_name = remainder.partition("/")
        if not separator or not bucket or not object_name or ".." in object_name.split("/"):
            raise MediaProtocolError("Veo returned a malformed GCS output URI")
        try:
            return storage.Client(project=self.project).bucket(bucket).blob(object_name).download_as_bytes()
        except Exception as exc:  # noqa: BLE001 - Cloud Storage client has several transport errors
            raise MediaProviderError("Veo GCS output download failed") from exc


def _decode(value: Any, *, media: str) -> bytes:
    if not isinstance(value, str) or not value:
        raise MediaProtocolError(f"{media} response is missing encoded data")
    try:
        data = base64.b64decode(value, validate=True)
    except ValueError as exc:
        raise MediaProtocolError(f"{media} response contains invalid encoded data") from exc
    if not data:
        raise MediaProtocolError(f"{media} response decoded to empty data")
    return data


_PROVENANCE_EXCLUDED_KEYS = {
    "audioContent", "bytesBase64Encoded", "bytes_base64_encoded", "data", "input", "prompt",
}


def _bounded_provenance(value: Any, *, depth: int = 0) -> Any:
    """Copy small JSON metadata while excluding prompts and encoded media payloads."""
    if depth > 4:
        return None
    if value is None or isinstance(value, (bool, int, float)):
        return value
    if isinstance(value, str):
        return value[:512]
    if isinstance(value, list):
        return [_bounded_provenance(item, depth=depth + 1) for item in value[:8]]
    if isinstance(value, dict):
        return {
            str(key)[:128]: _bounded_provenance(item, depth=depth + 1)
            for key, item in list(value.items())[:16]
            if str(key) not in _PROVENANCE_EXCLUDED_KEYS
        }
    return str(value)[:1000]


def _common_provider_provenance(response: dict[str, Any]) -> dict[str, Any]:
    usage = response.get("usageMetadata") or response.get("usage_metadata") or response.get("usage")
    model_status = (
        response.get("modelStatus") or response.get("model_status")
        or response.get("releaseStatus") or response.get("release_status")
    )
    cost = response.get("costMetadata") or response.get("cost_metadata")
    return {
        **({"usageMetadata": _bounded_provenance(usage)} if usage else {}),
        **({"modelStatus": _bounded_provenance(model_status)} if model_status else {}),
        **({"costMetadata": _bounded_provenance(cost)} if cost else {}),
    }


def _fit_provider_metadata(metadata: dict[str, Any], *, maximum_bytes: int = 3072) -> dict[str, Any]:
    """Keep prioritized provenance fields within the artifact transport's header budget."""
    result: dict[str, Any] = {}
    truncated = False
    for key, value in metadata.items():
        candidate = {**result, key: value}
        if len(json.dumps(candidate, separators=(",", ":")).encode("utf-8")) <= maximum_bytes:
            result[key] = value
            continue
        truncated = True
        if isinstance(value, str):
            low, high = 0, len(value)
            while low < high:
                midpoint = (low + high + 1) // 2
                candidate = {**result, key: value[:midpoint]}
                if len(json.dumps(candidate, separators=(",", ":")).encode("utf-8")) <= maximum_bytes - 32:
                    low = midpoint
                else:
                    high = midpoint - 1
            if low:
                result[key] = value[:low]
    if truncated:
        marker = {**result, "provenanceTruncated": True}
        if len(json.dumps(marker, separators=(",", ":")).encode("utf-8")) <= maximum_bytes:
            result["provenanceTruncated"] = True
    return result


class VeoGenerator:
    def __init__(self, *, transport: MediaTransport) -> None:
        self.transport = transport

    def generate(
        self,
        *,
        request: dict[str, Any],
        existing_operation: str | None,
        persist_operation: Callable[[str], None],
        authorized_output_prefix: str | None = None,
        conditioning_media: dict[str, tuple[bytes, str, str]] | None = None,
    ) -> GeneratedMedia:
        request = validate_veo_request(request)
        duration_sec = int(request["durationSec"])
        with tracer().start_as_current_span("harmonia.media.generate") as span:
            span.set_attributes(safe_attributes({
                "provider": "vertex_ai", "model": request["providerModel"],
                "media.kind": "video", "media.duration_sec": duration_sec,
            }))
            operation_name = existing_operation
            if operation_name is None:
                media = conditioning_media or {}
                source_image = self._provider_image(request.get("sourceImageArtifact"), media)
                last_frame = self._provider_image(request.get("lastFrameArtifact"), media)
                started = self.transport.start_veo(
                    model=request["providerModel"],
                    mode=request["mode"],
                    prompt=request["prompt"],
                    duration_sec=duration_sec,
                    aspect_ratio=request["aspectRatio"],
                    resolution=request["resolution"],
                    generate_audio=request["generateAudio"],
                    seed=request.get("seed"),
                    enhance_prompt=request["enhancePrompt"],
                    source_image=source_image,
                    last_frame=last_frame,
                    storage_uri=authorized_output_prefix,
                )
                operation_name = started.get("name")
                if not isinstance(operation_name, str) or not operation_name:
                    raise MediaProtocolError("Veo did not return an operation name")
                persist_operation(operation_name)
            polled = self.transport.poll_veo(operation_name, str(request["providerModel"]))
            if polled.get("done") is not True:
                raise MediaOperationPending(operation_name)
            if polled.get("error"):
                raise MediaProtocolError("Veo operation completed with an error")
            videos = (polled.get("response") or {}).get("videos") or []
            if not videos:
                raise MediaProtocolError("Veo completed without a video output")
            video = videos[0]
            gcs_uri = video.get("gcsUri") or video.get("gcs_uri")
            if gcs_uri is not None:
                if not isinstance(gcs_uri, str) or not authorized_output_prefix or not gcs_uri.startswith(authorized_output_prefix):
                    raise MediaProtocolError("Veo output is outside its authorized GCS prefix")
                data = self.transport.download_gcs(gcs_uri, authorized_output_prefix)
            else:
                if authorized_output_prefix:
                    raise MediaProtocolError("Veo response is missing its required GCS output URI")
                data = _decode(
                    video.get("bytesBase64Encoded") or video.get("bytes_base64_encoded"),
                    media="video",
                )
            response = polled.get("response") or {}
            provider_metadata = {
                **({"gcsUri": gcs_uri} if gcs_uri else {}),
                **({"raiMediaFilteredCount": _bounded_provenance(response["raiMediaFilteredCount"])} if "raiMediaFilteredCount" in response else {}),
                **({"raiMediaFilteredReasons": _bounded_provenance(response["raiMediaFilteredReasons"])} if "raiMediaFilteredReasons" in response else {}),
                **_common_provider_provenance(response),
                **({"watermark": _bounded_provenance(video["watermark"])} if "watermark" in video else {}),
                **({"c2pa": _bounded_provenance(video["c2pa"])} if "c2pa" in video else {}),
            }
            return GeneratedMedia(
                data=data,
                mime=str(video.get("mimeType") or video.get("mime_type") or "video/mp4"),
                model=request["providerModel"],
                provider_id=operation_name,
                duration_sec=duration_sec,
                estimated_cost_usd=estimate_media_cost(request),
                provider_metadata=_fit_provider_metadata(provider_metadata),
            )

    @staticmethod
    def _provider_image(
        reference: Any,
        conditioning_media: dict[str, tuple[bytes, str, str]],
    ) -> dict[str, str] | None:
        if reference is None:
            return None
        sealed = _validate_conditioning_reference(reference)
        materialized = conditioning_media.get(sealed["artifactId"])
        if materialized is None:
            raise MediaProtocolError("Veo conditioning media is missing")
        data, mime, digest = materialized
        if (
            not data
            or mime != sealed["mime"]
            or digest != sealed["digest"]
            or len(data) != sealed["sizeBytes"]
        ):
            raise MediaProtocolError("Veo conditioning media does not match its sealed identity")
        return {
            "bytesBase64Encoded": base64.b64encode(data).decode("ascii"),
            "mimeType": mime,
        }


class LyriaGenerator:
    def __init__(self, *, transport: MediaTransport) -> None:
        self.transport = transport

    def generate(self, *, request: dict[str, Any], estimated_cost_usd: str) -> GeneratedMedia:
        request = validate_lyria_request(request)
        duration_sec = int(request["targetDurationSec"])
        model = str(request["providerModel"])
        with tracer().start_as_current_span("harmonia.media.generate") as span:
            span.set_attributes(safe_attributes({
                "provider": "vertex_ai", "model": model,
                "media.kind": "audio", "media.duration_sec": duration_sec,
            }))
            response = self.transport.generate_lyria(model=model, prompt=request["prompt"], request=request)
            if response.get("status") != "completed":
                raise MediaProtocolError("Lyria interaction did not complete")
            output = next(
                (item for item in response.get("outputs", []) if item.get("type") == "audio"),
                None,
            )
            if output is None:
                raise MediaProtocolError("Lyria completed without an audio output")
            provider_id = response.get("id")
            if not isinstance(provider_id, str) or not provider_id:
                raise MediaProtocolError("Lyria response is missing an interaction id")
            text_outputs = [
                str(item.get("text"))[:12000]
                for item in response.get("outputs", [])
                if isinstance(item, dict) and item.get("type") == "text" and isinstance(item.get("text"), str)
            ]
            provider_metadata = {
                **{
                    key: _bounded_provenance(response[key])
                    for key in ("object", "status", "role", "model", "created", "updated")
                    if key in response
                },
                **({"lyrics": text_outputs[0]} if text_outputs else {}),
                **({"description": text_outputs[1]} if len(text_outputs) > 1 else {}),
                **({"watermark": _bounded_provenance(response["watermark"])} if "watermark" in response else {}),
                **({"c2pa": _bounded_provenance(output["c2pa"])} if "c2pa" in output else {}),
                **_common_provider_provenance(response),
            }
            return GeneratedMedia(
                data=_decode(output.get("data"), media="audio"),
                mime=str(output.get("mime_type") or "audio/mpeg"),
                model=model,
                provider_id=provider_id,
                duration_sec=duration_sec,
                estimated_cost_usd=estimated_cost_usd,
                provider_metadata=_fit_provider_metadata(provider_metadata),
            )
