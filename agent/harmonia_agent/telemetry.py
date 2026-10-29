"""Metadata-only OpenTelemetry setup and W3C trace propagation."""

from __future__ import annotations

import os
from collections.abc import Mapping, MutableMapping
from typing import Any

import google.auth
import google.auth.transport.grpc
import google.auth.transport.requests
import grpc
from opentelemetry import propagate, trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import SERVICE_NAME, Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, SimpleSpanProcessor, SpanExporter
from opentelemetry.sdk.trace.sampling import ParentBased, TraceIdRatioBased
from opentelemetry.trace.propagation.tracecontext import TraceContextTextMapPropagator
from google.adk.telemetry.google_cloud import get_gcp_exporters
from google.adk.telemetry.setup import maybe_set_otel_providers

from .config import settings

_CONTENT_FIELDS = {"body", "content", "media", "prompt", "response", "text", "transcript"}
_provider: Any | None = None
_global_provider_registered = False


def _build_channel_credentials():
    credentials, _ = google.auth.default(
        scopes=("https://www.googleapis.com/auth/cloud-platform",)
    )
    request = google.auth.transport.requests.Request()
    plugin = google.auth.transport.grpc.AuthMetadataPlugin(
        credentials=credentials,
        request=request,
    )
    return grpc.composite_channel_credentials(
        grpc.ssl_channel_credentials(),
        grpc.metadata_call_credentials(plugin),
    )


def _cloud_exporter() -> OTLPSpanExporter:
    return OTLPSpanExporter(
        credentials=_build_channel_credentials(),
        endpoint="telemetry.googleapis.com:443",
    )


def _privacy_environment() -> None:
    """Disable ADK/GenAI message capture for every telemetry signal."""
    os.environ["ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS"] = "false"
    os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] = "NO_CONTENT"


def _otel_resource() -> Resource:
    cfg = settings()
    return Resource.create({
        SERVICE_NAME: cfg.otel_service_name,
        "gcp.project_id": cfg.gcp_project,
        "service.version": os.environ.get("K_REVISION", "local"),
        "deployment.environment.name": os.environ.get("HARMONIA_ENVIRONMENT", "development"),
    })


def configure_adk_telemetry(*, enabled: bool | None = None) -> None:
    """Configure ADK's native logs, metrics, and traces through Google Cloud."""
    _privacy_environment()
    cfg = settings()
    if enabled is None:
        enabled = cfg.telemetry_enabled
    if not enabled:
        return
    # ADK constructs the SDK provider, which reads the standard OTel sampler
    # environment at construction time.
    os.environ["OTEL_TRACES_SAMPLER"] = "parentbased_traceidratio"
    os.environ["OTEL_TRACES_SAMPLER_ARG"] = str(cfg.telemetry_sample_rate)
    hooks = get_gcp_exporters(
        enable_cloud_logging=True,
        enable_cloud_metrics=True,
        enable_cloud_tracing=True,
    )
    maybe_set_otel_providers([hooks], otel_resource=_otel_resource())


def configure_telemetry(
    *,
    exporter: SpanExporter | None = None,
    force: bool = False,
) -> TracerProvider:
    """Configure a tracer provider; tests may inject an in-memory exporter."""
    global _provider, _global_provider_registered
    # ADK's legacy content capture defaults on. Harmonia's audit policy is
    # metadata-only, so enforce both the legacy and current controls here.
    _privacy_environment()
    if _provider is not None and not force:
        return _provider
    if _provider is not None and force:
        _provider.shutdown()

    cfg = settings()
    if exporter is None and cfg.telemetry_enabled:
        configure_adk_telemetry(enabled=True)
        _provider = trace.get_tracer_provider()
        propagate.set_global_textmap(TraceContextTextMapPropagator())
        _global_provider_registered = True
        return _provider

    provider = TracerProvider(
        resource=_otel_resource(),
        sampler=ParentBased(TraceIdRatioBased(cfg.telemetry_sample_rate)),
    )
    if exporter is not None:
        provider.add_span_processor(SimpleSpanProcessor(exporter))

    _provider = provider
    propagate.set_global_textmap(TraceContextTextMapPropagator())
    if not _global_provider_registered:
        trace.set_tracer_provider(provider)
        _global_provider_registered = True
    return provider


def tracer() -> trace.Tracer:
    provider = _provider or configure_telemetry()
    return provider.get_tracer("harmonia.agent")


def extract_context(carrier: Mapping[str, str]):
    return propagate.extract(carrier=dict(carrier))


def inject_context(carrier: MutableMapping[str, str]) -> None:
    propagate.inject(carrier=carrier)


def current_trace_id() -> str:
    context = trace.get_current_span().get_span_context()
    return f"{context.trace_id:032x}" if context.is_valid else "0" * 32


def current_span_id() -> str:
    context = trace.get_current_span().get_span_context()
    return f"{context.span_id:016x}" if context.is_valid else "0" * 16


def safe_attributes(values: Mapping[str, Any]) -> dict[str, Any]:
    """Return low-cardinality metadata while excluding content-bearing fields."""
    safe: dict[str, Any] = {}
    for key, value in values.items():
        normalized = key.lower().replace("-", "_")
        segments = set(normalized.replace("/", ".").split("."))
        if segments & _CONTENT_FIELDS:
            continue
        if isinstance(value, (str, bool, int, float)):
            safe[key] = value
    return safe
