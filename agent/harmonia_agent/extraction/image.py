"""Still-image normalization with Muse Spark image understanding.

An uploaded screenshot, slide, chart, or product photo is stored once as a
source artifact; Muse Spark returns the text visible in it plus factual visual
observations under a strict JSON schema. Every segment points at that stored
image through a ``frame`` locator, so Nimi can cite it like a video still.

Docs: docs/meta/image-understanding.md, structured-output.md.
"""

from __future__ import annotations

import base64
import json
import subprocess
import tempfile
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable

import httpx

from .. import meta_api
from ..agent_models import ContentSegment, FrameLocator, NormalizedSource
from ..model_catalog import PRICING_VERSION, estimate_text_cost
from ..telemetry import current_trace_id, safe_attributes, tracer
from ..usage import InvocationContext, UsageRecord
from ..video_understanding import _output_text, video_model
from ..web_client import report_usage, reserve_budget, resolve_budget_reservation

IMAGE_MIME_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}
MAX_OBSERVATIONS = 12
MAX_OUTPUT_TOKENS = 4000
# The internal artifact store accepts at most 8 MiB per object.
MAX_STORED_IMAGE_BYTES = 7_500_000
# Meta does not publish an image token rate; reserve generously, record actual usage.
ESTIMATED_IMAGE_INPUT_TOKENS = 3000

IMAGE_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "properties": {
        "visibleText": {"type": "string"},
        "observations": {"type": "array", "maxItems": MAX_OBSERVATIONS, "items": {"type": "string"}},
    },
    "required": ["visibleText", "observations"],
}

PROMPT = (
    "You are reading an image a startup supplied as source material. Return visibleText: the text "
    "readable in the image, verbatim, in reading order (empty if none). Return observations: up to 12 "
    "short factual sentences about what is visible (product UI, charts and their trend, people, objects, "
    "layout). Describe only what is visible; do not guess identities, intent, or numbers you cannot read."
)


class ImageUnderstandingError(RuntimeError):
    pass


def _observe(client: httpx.Client, model: str, image: bytes, mime: str) -> tuple[str, dict[str, Any]]:
    response = client.post("/responses", json={
        "model": model,
        "reasoning": {"effort": "low"},
        "max_output_tokens": MAX_OUTPUT_TOKENS,
        "input": [{"type": "message", "role": "user", "content": [
            {"type": "input_text", "text": PROMPT},
            {"type": "input_image", "image_url": f"data:{mime};base64," + base64.b64encode(image).decode()},
        ]}],
        "text": {"format": {"type": "json_schema", "name": "ImageEvidence", "schema": IMAGE_SCHEMA, "strict": True}},
    })
    if response.status_code >= 300:
        raise ImageUnderstandingError(f"image understanding failed ({response.status_code}): {response.text[:200]}")
    body = response.json()
    return _output_text(body), dict(body.get("usage") or {})


def parse_image_evidence(text: str) -> tuple[str, list[str]]:
    try:
        raw = json.loads(text)
        visible = str(raw["visibleText"]).strip()
        observations = [str(item).strip() for item in raw["observations"] if str(item).strip()]
    except (ValueError, KeyError, TypeError) as exc:
        raise ImageUnderstandingError("image understanding returned malformed JSON") from exc
    return visible[:4000], [item[:500] for item in observations[:MAX_OBSERVATIONS]]


def extract_image(
    source_id: str,
    title: str,
    body: bytes,
    mime_type: str,
    *,
    invocation: InvocationContext,
    receipt_id: str,
    store_image: Callable[[bytes, str], str] | None = None,
    observe: Callable[[httpx.Client, str, bytes, str], tuple[str, dict[str, Any]]] = _observe,
    client_factory: Callable[[float], httpx.Client] = lambda timeout: meta_api.client(timeout, purpose="Muse Spark image understanding"),
    budget_reserver: Callable[[dict[str, object]], None] = reserve_budget,
    budget_resolver: Callable[[dict[str, object]], None] = resolve_budget_reservation,
    usage_reporter: Callable[[dict[str, object]], None] = report_usage,
) -> NormalizedSource:
    if not body:
        raise ValueError("image source is empty")
    if mime_type not in IMAGE_MIME_TYPES:
        raise ValueError(f"unsupported image type: {mime_type}")
    role = "image_reader"
    model = video_model()
    operation_id = invocation.role_operation_id(role)
    budget_reserver({
        "jobId": invocation.job_id, "operationId": operation_id, "stage": invocation.stage,
        "role": role, "model": model,
        "estimatedCostUsd": str(estimate_text_cost(model, ESTIMATED_IMAGE_INPUT_TOKENS, MAX_OUTPUT_TOKENS)),
        "pricingVersion": PRICING_VERSION,
    })
    state = "reserved"
    try:
        with tracer().start_as_current_span("harmonia.model.generate") as span:
            span.set_attributes(safe_attributes({
                "job.id": invocation.job_id, "stage": invocation.stage, "agent": role, "model": model,
            }))
            with client_factory(180.0) as client:
                state = "dispatched"
                text, usage = observe(client, model, body, mime_type)
            input_tokens = int(usage.get("input_tokens") or ESTIMATED_IMAGE_INPUT_TOKENS)
            output_tokens = int(usage.get("output_tokens") or 0)
            cached = min(int((usage.get("input_tokens_details") or {}).get("cached_tokens") or 0), input_tokens)
            cost = estimate_text_cost(model, input_tokens, output_tokens, cached)
            usage_reporter(UsageRecord(
                id=f"usage-{sha256(operation_id.encode()).hexdigest()[:24]}",
                job_id=invocation.job_id, operation_id=operation_id, stage=invocation.stage,
                role=role, model=model, input_units=input_tokens, output_units=output_tokens,
                cached_input_units=cached or None, unit_type="tokens", estimated_cost_usd=str(cost),
                trace_id=current_trace_id(), created_at=datetime.now(timezone.utc).isoformat(),
            ).to_wire())
            state = "reported"
            span.set_attributes(safe_attributes({
                "input.units": input_tokens, "output.units": output_tokens, "cost.estimated_usd": str(cost),
            }))
    except Exception:
        if state != "reported":
            budget_resolver({
                "jobId": invocation.job_id, "operationId": operation_id,
                "outcome": "uncertain" if state == "dispatched" else "not_invoked",
                "reason": f"image understanding failed {'after' if state == 'dispatched' else 'before'} provider dispatch",
            })
        raise
    visible, observations = parse_image_evidence(text)
    texts = ([f"Visible text: {visible}"] if visible else []) + observations
    if not texts:
        raise ValueError("image understanding produced no evidence segments")
    artifact_id = (store_image or _store_image(invocation))(body, mime_type)
    return NormalizedSource(
        sourceId=source_id,
        sourceKind="document",
        title=title,
        mimeType=mime_type,
        contentDigest=sha256(body).hexdigest(),
        extractorVersion=f"meta-{model}-image",
        extractedAt=datetime.now(timezone.utc),
        segments=[
            ContentSegment(
                id=f"image-{index}", text=item,
                locator=FrameLocator(timestampMs=0, frameArtifactId=artifact_id),
                digest=sha256(item.encode("utf-8")).hexdigest(),
            )
            for index, item in enumerate(texts, start=1)
        ],
        metadata={"mediaType": "image", "observationCount": len(observations), "hasVisibleText": bool(visible)},
        extractionReceiptId=receipt_id,
    )


def _downscale(image: bytes) -> bytes:
    """Fit an oversized source image under the artifact store's size limit."""
    with tempfile.TemporaryDirectory() as td:
        source, target = Path(td) / "source", Path(td) / "image.jpg"
        source.write_bytes(image)
        proc = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(source), "-frames:v", "1",
             "-vf", "scale='min(2048,iw)':-2", "-q:v", "3", str(target)],
            capture_output=True, text=True, timeout=120,
        )
        if proc.returncode != 0 or not target.exists():
            raise ImageUnderstandingError(f"could not downscale source image: {(proc.stderr or '')[-200:]}")
        return target.read_bytes()


def _store_image(invocation: InvocationContext) -> Callable[[bytes, str], str]:
    from ..web_client import create_artifact

    def store(image: bytes, mime: str) -> str:
        if len(image) > MAX_STORED_IMAGE_BYTES:
            image, mime = _downscale(image), "image/jpeg"
        return str(create_artifact(
            job_id=invocation.job_id, operation_id=invocation.operation_id, content=image,
            content_type=mime, trust="operator",
            producer={"kind": "extractor", "id": "source-image", "version": "1"},
            retention_class="source",
        )["id"])

    return store
