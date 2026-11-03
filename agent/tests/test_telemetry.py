import asyncio
import os
from dataclasses import replace

from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

import harmonia_agent.telemetry as telemetry
from harmonia_agent import stages
from harmonia_agent.telemetry import (
    configure_adk_telemetry,
    configure_telemetry,
    current_trace_id,
    inject_context,
    safe_attributes,
    tracer,
)


def test_adk_cloud_exporters_enable_logs_metrics_and_traces(monkeypatch):
    captured = {}
    marker = object()
    monkeypatch.setattr(telemetry, "get_gcp_exporters", lambda **kwargs: captured.update(kwargs) or marker)
    monkeypatch.setattr(
        telemetry,
        "maybe_set_otel_providers",
        lambda hooks, otel_resource=None: captured.update(hooks=hooks, resource=otel_resource),
    )

    configure_adk_telemetry(enabled=True)

    assert captured["enable_cloud_logging"] is True
    assert captured["enable_cloud_metrics"] is True
    assert captured["enable_cloud_tracing"] is True
    assert captured["hooks"] == [marker]
    assert captured["resource"].attributes["service.name"] == "harmonia-agent"
    assert captured["resource"].attributes["gcp.project_id"] == "harmonia-local"


def test_adk_telemetry_never_captures_message_content(monkeypatch):
    monkeypatch.setattr(telemetry, "maybe_set_otel_providers", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(telemetry, "get_gcp_exporters", lambda **_kwargs: object())

    configure_adk_telemetry(enabled=True)

    assert os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] == "NO_CONTENT"
    assert os.environ["ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS"] == "false"


def test_adk_telemetry_applies_configured_parent_based_sampling(monkeypatch):
    monkeypatch.setattr(telemetry, "maybe_set_otel_providers", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(telemetry, "get_gcp_exporters", lambda **_kwargs: object())
    configured = replace(telemetry.settings(), telemetry_sample_rate=0.25)
    monkeypatch.setattr(telemetry, "settings", lambda: configured)

    configure_adk_telemetry(enabled=True)

    assert os.environ["OTEL_TRACES_SAMPLER"] == "parentbased_traceidratio"
    assert os.environ["OTEL_TRACES_SAMPLER_ARG"] == "0.25"


def test_w3c_context_round_trip():
    exporter = InMemorySpanExporter()
    configure_telemetry(exporter=exporter, force=True)
    carrier: dict[str, str] = {}
    with tracer().start_as_current_span("harmonia.stage.execute"):
        inject_context(carrier)
        assert len(current_trace_id()) == 32
    assert carrier["traceparent"].startswith("00-")


def test_safe_attributes_drop_content_fields():
    assert safe_attributes({
        "job_id": "j1",
        "model": "m1",
        "prompt": "private",
        "request.body": "private",
        "transcript": "private",
        "response": "private",
        "optional": None,
    }) == {"job_id": "j1", "model": "m1"}


def test_cloud_exporter_uses_native_otlp_telemetry_endpoint(monkeypatch):
    captured = {}
    marker = object()
    monkeypatch.setattr(telemetry, "_build_channel_credentials", lambda: marker)
    monkeypatch.setattr(
        telemetry,
        "OTLPSpanExporter",
        lambda **kwargs: captured.update(kwargs) or object(),
    )

    telemetry._cloud_exporter()

    assert captured == {
        "credentials": marker,
        "endpoint": "telemetry.googleapis.com:443",
    }


def test_stage_dispatch_creates_a_metadata_only_child_span(monkeypatch):
    exporter = InMemorySpanExporter()
    configure_telemetry(exporter=exporter, force=True)

    async def handler(_job_id: str) -> None:
        return None

    monkeypatch.setitem(stages.HANDLERS, "understand", handler)
    monkeypatch.setattr(stages, "get_job", lambda _job_id: {"controlState": "running"})
    monkeypatch.setattr(stages, "claim_stage_execution", lambda _payload: {"outcome": "execute"})
    monkeypatch.setattr(stages, "finalize_stage_execution", lambda _payload: None)
    with tracer().start_as_current_span("parent"):
        assert asyncio.run(stages.dispatch("job-1", "understand", attempt=2)) is True

    spans = {span.name: span for span in exporter.get_finished_spans()}
    stage_span = spans["harmonia.stage.execute"]
    assert stage_span.attributes == {
        "job.id": "job-1",
        "stage": "understand",
        "attempt": 2,
    }
    assert all("prompt" not in str(value) for value in stage_span.attributes.values())
