# Observability and Cost Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add end-to-end OpenTelemetry trace propagation, immutable per-model usage records, versioned cost estimation, and enforceable job budgets before Harmonia adds heterogeneous models or paid generated media.

**Architecture:** The Next.js control plane creates and propagates W3C trace context through Pub/Sub. The Python worker continues the trace across stages and ADK events, exports metadata-only spans to Cloud Trace, and reports normalized usage records to a new internal web endpoint. Firestore remains the durable source of truth for budgets and usage; a transactional reservation endpoint prevents a model call from exceeding a job budget.

**Tech Stack:** Next.js 16, TypeScript, Zod, Firestore, Pub/Sub, Python 3.12, FastAPI, Google ADK 2.7.x, Pydantic 2, OpenTelemetry SDKs, Google Cloud Trace exporter, Vitest, pytest

**Spec:** `docs/superpowers/specs/2026-08-23-managed-multimodel-agent-platform-design.md`

## Global Constraints

- Preserve Pub/Sub and Firestore as Harmonia's durable workflow control plane.
- Agents receive no publishing, approval, credential-management, or destructive tools.
- Traces contain execution metadata and explicit structured decisions, never private chain-of-thought, raw prompts, raw responses, transcripts, or media bytes.
- No provider or model failure silently falls back to another model or deterministic fixture output.
- Existing HTTP routes, stage names, job fields, X action IDs, and idempotency derivation remain compatible.
- New trace, usage, budget, and pricing fields are additive.
- Pricing estimates and observed usage are labeled separately and retain a versioned rate source.
- Unknown pricing is not budget-authorized.
- Offline suites remain network-free and use in-memory telemetry exporters.

---

## File Structure

### New Python files

- `agent/harmonia_agent/model_catalog.py` — versioned model rates and `Decimal` cost calculations.
- `agent/harmonia_agent/usage.py` — immutable usage models, request estimates, and ADK event normalization.
- `agent/harmonia_agent/telemetry.py` — tracer initialization, safe attributes, W3C carrier extraction, and test exporter support.
- `agent/tests/test_model_catalog.py` — pricing and estimation tests.
- `agent/tests/test_telemetry.py` — trace propagation and content-redaction tests.
- `agent/tests/test_usage.py` — ADK usage normalization and reporting tests.

### New TypeScript files

- `src/lib/telemetry.ts` — W3C context creation/injection and server span helpers.
- `src/lib/costs.ts` — budget and usage domain functions used by Firestore and routes.
- `src/app/api/internal/usage/route.ts` — authenticated usage finalization endpoint.
- `src/app/api/internal/budget/reserve/route.ts` — authenticated transactional budget reservation endpoint.
- `tests/telemetry.test.ts` — carrier behavior without network export.
- `tests/costs.test.ts` — budget reservation and aggregation behavior.

### Modified files

- `agent/requirements.txt` — Python OpenTelemetry dependencies.
- `agent/harmonia_agent/config.py` — telemetry and pricing configuration.
- `agent/harmonia_agent/main.py` — initialize instrumentation and extract Pub/Sub trace context.
- `agent/harmonia_agent/agents.py` — spans for delegation/model validation and usage collection.
- `agent/harmonia_agent/content.py` — transcription/image usage normalization.
- `agent/harmonia_agent/stages.py` — stage spans, budget reservation, and usage reporting.
- `agent/harmonia_agent/web_client.py` — propagate trace headers on internal HTTP calls.
- `package.json` and lockfile — Node OpenTelemetry dependencies.
- `src/lib/types.ts` — additive trace, usage, budget, and pricing types.
- `src/lib/contracts.ts` — internal usage and reservation schemas.
- `src/lib/firestore.ts` — budget transaction and usage persistence.
- `src/lib/pubsub.ts` — inject W3C trace context into Pub/Sub attributes.
- `src/lib/advance.ts` — keep child context on stage publication.
- `src/app/api/metrics/route.ts` — aggregate model usage and estimated cost.
- `infra/setup.sh` — enable trace/telemetry services and minimum trace permissions.
- `infra/deploy.sh` — configure telemetry service names and content capture defaults.
- `.env.example` and `docs/configuration.mdx` — document safe telemetry and budget settings.
- `docs/architecture.mdx` — show correlated traces and cost ledger.

---

### Task 1: Versioned Model Catalog and Decimal Cost Calculation

**Files:**
- Create: `agent/harmonia_agent/model_catalog.py`
- Create: `agent/tests/test_model_catalog.py`
- Modify: `agent/harmonia_agent/config.py`

**Interfaces:**
- Consumes: model identifier, input/output usage units, and the configured pricing version.
- Produces: `PricingEntry`, `lookup_pricing(model_id)`, `estimate_text_cost(model_id, input_tokens, output_tokens)`, and `UnknownModelPrice`.

- [ ] **Step 1: Write failing catalog tests**

```python
from decimal import Decimal

import pytest

from harmonia_agent.model_catalog import (
    PRICING_VERSION,
    UnknownModelPrice,
    estimate_text_cost,
    lookup_pricing,
)


def test_flash_cost_uses_decimal_rates():
    assert PRICING_VERSION == "2026-08-23"
    entry = lookup_pricing("gemini-3.5-flash")
    assert entry.input_usd_per_million == Decimal("1.50")
    assert entry.output_usd_per_million == Decimal("9.00")
    assert estimate_text_cost("gemini-3.5-flash", 100_000, 10_000) == Decimal("0.240000")


def test_unknown_model_price_is_not_treated_as_free():
    with pytest.raises(UnknownModelPrice):
        estimate_text_cost("unpriced-model", 100, 100)
```

- [ ] **Step 2: Run the focused test and verify that imports fail**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_model_catalog.py -q`

Expected: FAIL because `harmonia_agent.model_catalog` does not exist.

- [ ] **Step 3: Implement the immutable pricing catalog**

```python
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP

PRICING_VERSION = "2026-08-23"
RATE_SOURCE = "https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing"
MILLION = Decimal("1000000")


class UnknownModelPrice(ValueError):
    pass


@dataclass(frozen=True)
class PricingEntry:
    model: str
    input_usd_per_million: Decimal
    output_usd_per_million: Decimal
    version: str = PRICING_VERSION
    source: str = RATE_SOURCE


CATALOG = {
    "gemini-3.5-flash": PricingEntry(
        model="gemini-3.5-flash",
        input_usd_per_million=Decimal("1.50"),
        output_usd_per_million=Decimal("9.00"),
    ),
    "gemini-3.5-flash-lite": PricingEntry(
        model="gemini-3.5-flash-lite",
        input_usd_per_million=Decimal("0.30"),
        output_usd_per_million=Decimal("2.50"),
    ),
}


def lookup_pricing(model_id: str) -> PricingEntry:
    try:
        return CATALOG[model_id]
    except KeyError as exc:
        raise UnknownModelPrice(f"no price configured for model: {model_id}") from exc


def estimate_text_cost(model_id: str, input_tokens: int, output_tokens: int) -> Decimal:
    entry = lookup_pricing(model_id)
    total = (
        Decimal(input_tokens) * entry.input_usd_per_million
        + Decimal(output_tokens) * entry.output_usd_per_million
    ) / MILLION
    return total.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)
```

Add `pricing_version: str` to `Settings`, defaulting to `PRICING_VERSION`, and reject any configured version that differs from the loaded catalog.

- [ ] **Step 4: Run the catalog tests**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_model_catalog.py -q`

Expected: 2 passed.

- [ ] **Step 5: Commit the catalog**

```bash
git add agent/harmonia_agent/model_catalog.py agent/harmonia_agent/config.py agent/tests/test_model_catalog.py
git commit -m "feat(agent): add versioned model pricing catalog"
```

---

### Task 2: Immutable Usage Records and ADK Usage Normalization

**Files:**
- Create: `agent/harmonia_agent/usage.py`
- Create: `agent/tests/test_usage.py`
- Modify: `agent/harmonia_agent/agents.py`

**Interfaces:**
- Consumes: ADK event usage metadata and explicit role/model/stage/job context.
- Produces: `UsageRecord`, `UsageAccumulator.observe_event(event)`, `UsageAccumulator.finalize()`, and `estimate_request_tokens(payload, max_output_tokens)`.

- [ ] **Step 1: Write failing usage tests**

```python
from types import SimpleNamespace

from harmonia_agent.usage import UsageAccumulator, estimate_request_tokens


def test_estimate_request_tokens_is_deterministic():
    assert estimate_request_tokens('{"brief":"12345678"}', 200) == (5, 200)


def test_accumulator_sums_adk_usage_metadata():
    accumulator = UsageAccumulator(job_id="j1", stage="draft", role="nimi", model="gemini-3.5-flash")
    accumulator.observe_event(SimpleNamespace(usage_metadata=SimpleNamespace(
        prompt_token_count=120,
        candidates_token_count=30,
    )))
    accumulator.observe_event(SimpleNamespace(usage_metadata=SimpleNamespace(
        prompt_token_count=10,
        candidates_token_count=5,
    )))
    record = accumulator.finalize(trace_id="0" * 32)
    assert record.input_units == 130
    assert record.output_units == 35
    assert record.estimated_cost_usd == "0.000510"
```

- [ ] **Step 2: Run the focused test and verify failure**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_usage.py -q`

Expected: FAIL because `harmonia_agent.usage` does not exist.

- [ ] **Step 3: Implement strict usage models**

```python
from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from .model_catalog import PRICING_VERSION, estimate_text_cost


class UsageRecord(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id: str
    job_id: str
    stage: str
    role: str
    model: str
    input_units: int
    output_units: int
    unit_type: str = "tokens"
    estimated_cost_usd: str
    observed_cost_usd: str | None = None
    pricing_version: str = PRICING_VERSION
    trace_id: str
    created_at: str


def estimate_request_tokens(serialized_payload: str, max_output_tokens: int) -> tuple[int, int]:
    return ((len(serialized_payload) + 3) // 4, max_output_tokens)


class UsageAccumulator:
    def __init__(self, *, job_id: str, stage: str, role: str, model: str):
        self.job_id, self.stage, self.role, self.model = job_id, stage, role, model
        self.input_tokens = 0
        self.output_tokens = 0

    def observe_event(self, event: object) -> None:
        metadata = getattr(event, "usage_metadata", None)
        if metadata is None:
            return
        self.input_tokens += int(getattr(metadata, "prompt_token_count", 0) or 0)
        self.output_tokens += int(getattr(metadata, "candidates_token_count", 0) or 0)

    def finalize(self, *, trace_id: str) -> UsageRecord:
        return UsageRecord(
            id=str(uuid4()), job_id=self.job_id, stage=self.stage,
            role=self.role, model=self.model,
            input_units=self.input_tokens, output_units=self.output_tokens,
            estimated_cost_usd=str(estimate_text_cost(
                self.model, self.input_tokens, self.output_tokens,
            )),
            trace_id=trace_id,
            created_at=datetime.now(timezone.utc).isoformat(),
        )
```

Extend `_run_coordinator` with `job_id`, `stage`, and `usage_sink` keyword arguments. Feed every emitted ADK event into the accumulator. Do not write Firestore from `agents.py`; return or report the normalized record through the injected sink.

- [ ] **Step 4: Verify usage tests and existing team tests**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_usage.py tests/test_agent_team.py -q`

Expected: all focused tests pass, including fake-model delegation.

- [ ] **Step 5: Commit usage normalization**

```bash
git add agent/harmonia_agent/usage.py agent/harmonia_agent/agents.py agent/tests/test_usage.py
git commit -m "feat(agent): normalize per-role model usage"
```

---

### Task 3: Python OpenTelemetry Runtime

**Files:**
- Create: `agent/harmonia_agent/telemetry.py`
- Create: `agent/tests/test_telemetry.py`
- Modify: `agent/requirements.txt`
- Modify: `agent/harmonia_agent/config.py`
- Modify: `agent/harmonia_agent/main.py`

**Interfaces:**
- Consumes: W3C carriers from HTTP headers or Pub/Sub message attributes.
- Produces: `configure_telemetry()`, `tracer()`, `extract_context(carrier)`, `inject_context(carrier)`, `current_trace_id()`, and `safe_attributes(values)`.

- [ ] **Step 1: Add OpenTelemetry dependencies**

Append exact compatible dependency ranges:

```text
opentelemetry-api>=1.36,<2
opentelemetry-sdk>=1.36,<2
opentelemetry-exporter-gcp-trace>=1.9,<2
opentelemetry-instrumentation-fastapi>=0.57b0,<1
opentelemetry-instrumentation-httpx>=0.57b0,<1
```

Run: `cd agent && ./.venv/bin/pip install -r requirements.txt`

Expected: installation succeeds without replacing `google-adk>=2.7,<3`.

- [ ] **Step 2: Write failing telemetry tests**

```python
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter

from harmonia_agent.telemetry import configure_telemetry, inject_context, safe_attributes, tracer


def test_w3c_context_round_trip():
    exporter = InMemorySpanExporter()
    configure_telemetry(exporter=exporter, force=True)
    carrier = {}
    with tracer().start_as_current_span("harmonia.stage.execute"):
        inject_context(carrier)
    assert carrier["traceparent"].startswith("00-")


def test_safe_attributes_drop_content_fields():
    assert safe_attributes({
        "job_id": "j1", "model": "m1", "prompt": "private",
        "transcript": "private", "response": "private",
    }) == {"job_id": "j1", "model": "m1"}
```

- [ ] **Step 3: Run the focused tests and verify failure**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_telemetry.py -q`

Expected: FAIL because `harmonia_agent.telemetry` does not exist.

- [ ] **Step 4: Implement metadata-only tracing**

Use `TracerProvider`, `ParentBased(TraceIdRatioBased(sample_rate))`, `BatchSpanProcessor`, and `CloudTraceSpanExporter` in cloud mode. Use an injected exporter in tests. Install `TraceContextTextMapPropagator` globally. `safe_attributes` must reject keys named `prompt`, `response`, `transcript`, `media`, `content`, `text`, or `body`, including dotted suffixes.

Add settings:

```python
telemetry_enabled: bool
telemetry_sample_rate: float
otel_service_name: str
```

Defaults:

```text
HARMONIA_TELEMETRY_ENABLED=0 locally
HARMONIA_TELEMETRY_SAMPLE_RATE=1.0
OTEL_SERVICE_NAME=harmonia-agent
```

Initialize telemetry before constructing the FastAPI app, instrument FastAPI and `httpx`, and leave export disabled when telemetry is off.

- [ ] **Step 5: Run telemetry and worker tests**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_telemetry.py tests/test_units.py -q`

Expected: all focused tests pass without network export.

- [ ] **Step 6: Commit Python telemetry**

```bash
git add agent/requirements.txt agent/harmonia_agent/config.py agent/harmonia_agent/main.py agent/harmonia_agent/telemetry.py agent/tests/test_telemetry.py
git commit -m "feat(agent): export metadata-only OpenTelemetry traces"
```

---

### Task 4: W3C Context Across Next.js, Pub/Sub, and Worker Stages

**Files:**
- Create: `src/lib/telemetry.ts`
- Create: `tests/telemetry.test.ts`
- Modify: `package.json`
- Modify: lockfile
- Modify: `src/lib/pubsub.ts`
- Modify: `agent/harmonia_agent/main.py`
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `agent/harmonia_agent/web_client.py`

**Interfaces:**
- Consumes: active OpenTelemetry context and incoming Pub/Sub attributes.
- Produces: `buildStageMessage(jobId, stage, attempt)`, propagated `traceparent`/`tracestate`, and nested `harmonia.stage.execute` spans.

- [ ] **Step 1: Install Node OpenTelemetry dependencies**

Run:

```bash
npm install @opentelemetry/api @opentelemetry/sdk-trace-node @google-cloud/opentelemetry-cloud-trace-exporter
```

Expected: `package.json` and the lockfile include the three packages.

- [ ] **Step 2: Write failing carrier tests**

```typescript
import { describe, expect, it } from "vitest";
import { context, trace } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { buildStageMessage } from "@/lib/pubsub";

describe("trace propagation", () => {
  it("adds W3C trace context without placing content in attributes", async () => {
    const provider = new NodeTracerProvider();
    provider.register();
    const tracer = trace.getTracer("test");
    await tracer.startActiveSpan("root", async (span) => {
      const message = buildStageMessage("j1", "understand", 0);
      expect(message.attributes.traceparent).toMatch(/^00-/);
      expect(JSON.stringify(message.attributes)).not.toContain("prompt");
      span.end();
    });
  });
});
```

- [ ] **Step 3: Refactor message construction and implement context injection**

`buildStageMessage` returns:

```typescript
export interface BuiltStageMessage {
  data: Buffer;
  attributes: Record<string, string>;
}

export function buildStageMessage(jobId: string, stage: string, attempt: number): BuiltStageMessage {
  const attributes: Record<string, string> = { jobId, stage };
  propagation.inject(context.active(), attributes);
  return {
    data: Buffer.from(JSON.stringify({ jobId, stage, attempt } satisfies StageMessage)),
    attributes,
  };
}
```

`publishStage` passes this object to `topic.publishMessage`.

In `main.py`, extract `message.get("attributes", {})`, attach the context while calling `dispatch`, and pass the same logic through the emulator pull loop. In `stages.dispatch`, open `harmonia.stage.execute` with `job.id`, `stage`, and `attempt`, record exception status, and never attach payload content.

In `web_client.py`, inject W3C headers into internal HTTP calls so the Next.js internal routes remain correlated.

- [ ] **Step 4: Run both propagation suites**

Run:

```bash
npm test -- tests/telemetry.test.ts
cd agent && ./.venv/bin/python -m pytest tests/test_telemetry.py tests/test_agent_stages.py -q
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit trace propagation**

```bash
git add package.json package-lock.json src/lib/telemetry.ts src/lib/pubsub.ts tests/telemetry.test.ts agent/harmonia_agent/main.py agent/harmonia_agent/stages.py agent/harmonia_agent/web_client.py
git commit -m "feat: propagate traces across Pub/Sub stages"
```

---

### Task 5: Transactional Job Budgets and Usage Persistence

**Files:**
- Create: `src/lib/costs.ts`
- Create: `src/app/api/internal/budget/reserve/route.ts`
- Create: `src/app/api/internal/usage/route.ts`
- Create: `tests/costs.test.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/contracts.ts`
- Modify: `src/lib/firestore.ts`
- Modify: `src/lib/config.ts`
- Modify: `agent/harmonia_agent/web_client.py`

**Interfaces:**
- Consumes: a reservation `{jobId, operationId, role, model, estimatedCostUsd, pricingVersion}` and a finalized usage record.
- Produces: `reserveJobBudget`, `finalizeUsageRecord`, `listUsageRecords`, `summarizeUsage`, worker `reserve_budget`, and worker `report_usage`.

- [ ] **Step 1: Add additive domain types**

```typescript
export interface JobBudget {
  estimatedUsd: string;
  observedUsd: string;
  reservedUsd: string;
  limitUsd: string;
  approvalThresholdUsd: string;
}

export interface UsageRecord {
  id: string;
  jobId: string;
  operationId: string;
  stage: string;
  role: string;
  model: string;
  inputUnits: number;
  outputUnits: number;
  unitType: "tokens" | "images" | "video_seconds" | "audio_seconds" | "endpoint_seconds";
  estimatedCostUsd: string;
  observedCostUsd?: string;
  pricingVersion: string;
  traceId: string;
  createdAt: string;
}
```

Add `budget?: JobBudget` to `Job`. Newly created jobs receive defaults from `DEFAULT_JOB_BUDGET_USD` and `DEFAULT_JOB_APPROVAL_THRESHOLD_USD`; existing documents synthesize zero totals and the configured limits when read.

- [ ] **Step 2: Write failing cost-domain tests**

```typescript
import { describe, expect, it } from "vitest";
import { canReserve, summarizeUsage } from "@/lib/costs";

describe("job budgets", () => {
  it("rejects a reservation above the remaining limit", () => {
    expect(canReserve({ estimatedUsd: "0.20", observedUsd: "0.10", reservedUsd: "0.10", limitUsd: "0.30", approvalThresholdUsd: "0.20" }, "0.11")).toBe(false);
  });

  it("aggregates decimal strings without binary rounding drift", () => {
    expect(summarizeUsage([
      { model: "m1", estimatedCostUsd: "0.10" },
      { model: "m1", estimatedCostUsd: "0.20" },
    ])).toEqual({ totalEstimatedUsd: "0.30", byModel: { m1: "0.30" } });
  });
});
```

- [ ] **Step 3: Implement integer-microdollar arithmetic**

`src/lib/costs.ts` converts decimal dollar strings to integer microdollars, performs all comparisons and additions as `bigint`, and converts results back to fixed decimal strings. Do not use JavaScript floating-point arithmetic for budgets.

- [ ] **Step 4: Add strict internal contracts**

```typescript
export const budgetReservationSchema = z.object({
  jobId: z.string().min(1), operationId: z.string().min(1),
  stage: z.string().min(1), role: z.string().min(1), model: z.string().min(1),
  estimatedCostUsd: z.string().regex(/^\d+\.\d{1,6}$/),
  pricingVersion: z.string().min(1),
});

export const usageRecordSchema = z.object({
  id: z.string().min(1), jobId: z.string().min(1), operationId: z.string().min(1),
  stage: z.string().min(1), role: z.string().min(1), model: z.string().min(1),
  inputUnits: z.number().nonnegative(), outputUnits: z.number().nonnegative(),
  unitType: z.enum(["tokens", "images", "video_seconds", "audio_seconds", "endpoint_seconds"]),
  estimatedCostUsd: z.string().regex(/^\d+\.\d{1,6}$/),
  observedCostUsd: z.string().regex(/^\d+\.\d{1,6}$/).optional(),
  pricingVersion: z.string().min(1), traceId: z.string().regex(/^[0-9a-f]{32}$/),
  createdAt: z.string().datetime({ offset: true }),
});
```

- [ ] **Step 5: Implement idempotent Firestore transactions**

Store reservations at `jobs/{jobId}/cost_reservations/{operationId}` and usage at `jobs/{jobId}/usage_records/{recordId}`.

`reserveJobBudget` transaction rules:

1. An existing reservation with the same `operationId` returns its original result.
2. Convert job budget strings to microdollars.
3. Reject when `observed + reserved + requested > limit`.
4. Persist the reservation and increment `reservedUsd` and `estimatedUsd` atomically.

`finalizeUsageRecord` transaction rules:

1. An existing usage record returns without changing totals.
2. Require a matching accepted reservation.
3. Mark the reservation finalized.
4. Decrement `reservedUsd` by the reservation estimate.
5. Increment `observedUsd` by `observedCostUsd ?? estimatedCostUsd`.
6. Persist the immutable usage record.

- [ ] **Step 6: Implement authenticated internal routes and worker calls**

`POST /api/internal/budget/reserve` returns HTTP 200 with `{reserved: true}` or HTTP 409 with `{reserved: false, error: "job budget exceeded"}`.

`POST /api/internal/usage` finalizes the matching reservation and returns `{ok: true}`.

Add to `web_client.py`:

```python
def reserve_budget(payload: dict[str, object]) -> None: ...
def report_usage(payload: dict[str, object]) -> None: ...
```

Both functions propagate trace headers. HTTP 409 from reservation is a permanent budget protocol failure; transient server/transport errors remain retryable.

- [ ] **Step 7: Run cost, contract, and state regression tests**

Run:

```bash
npm test -- tests/costs.test.ts tests/contracts.test.ts tests/stages.test.ts
npx tsc --noEmit
```

Expected: all focused tests pass with no public route shape regressions.

- [ ] **Step 8: Commit budget persistence**

```bash
git add src/lib/costs.ts src/lib/types.ts src/lib/contracts.ts src/lib/firestore.ts src/lib/config.ts src/app/api/internal/budget/reserve/route.ts src/app/api/internal/usage/route.ts tests/costs.test.ts tests/contracts.test.ts agent/harmonia_agent/web_client.py
git commit -m "feat: enforce transactional job model budgets"
```

---

### Task 6: Instrument Model Calls and Enforce Reservations

**Files:**
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/content.py`
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `agent/tests/test_agent_team.py`
- Modify: `agent/tests/test_agent_stages.py`
- Create: `agent/tests/test_cost_reporting.py`

**Interfaces:**
- Consumes: model request estimate, job/stage/role context, ADK usage metadata, trace identifier.
- Produces: `run_metered(reservation, reserve, invoke, finalize)`, one reservation and one usage record per provider invocation, plus `harmonia.agent.invoke`, `harmonia.agent.delegate`, `harmonia.model.generate`, and `harmonia.output.validate` spans.

- [ ] **Step 1: Write a failing reservation-order test**

```python
import asyncio

from harmonia_agent.usage import run_metered


def test_model_call_reserves_budget_before_provider():
    order = []

    def reserve(payload):
        assert payload["operationId"] == "j1:draft:nimi:0"
        order.append("reserve")

    async def invoke():
        order.append("model")
        return "validated-result", {"id": "usage-1"}

    def finalize(payload):
        assert payload == {"id": "usage-1"}
        order.append("usage")

    result = asyncio.run(run_metered(
        reservation={"operationId": "j1:draft:nimi:0"},
        reserve=reserve,
        invoke=invoke,
        finalize=finalize,
    ))

    assert result == "validated-result"
    assert order == ["reserve", "model", "usage"]
```

Implement the test using the existing scripted fake ADK model so it remains offline and exercises a real Runner event sequence.

- [ ] **Step 2: Add operation context to internal entry points**

Add an additive context model:

```python
class InvocationContext(BaseModel):
    job_id: str
    stage: str
    operation_id: str
```

The three team entry points receive it as a keyword-only argument. Stage callers derive deterministic operation IDs from `job_id`, stage, role, and attempt. Existing direct test calls use an explicit test context; no random operation ID is generated inside an agent function.

- [ ] **Step 3: Reserve, trace, collect, and finalize each ADK invocation**

Add this orchestration primitive to `usage.py` so ordering is independently testable:

```python
from collections.abc import Awaitable, Callable
from typing import Any, TypeVar

R = TypeVar("R")


async def run_metered(
    *,
    reservation: dict[str, object],
    reserve: Callable[[dict[str, object]], None],
    invoke: Callable[[], Awaitable[tuple[R, dict[str, object]]]],
    finalize: Callable[[dict[str, object]], None],
) -> R:
    reserve(reservation)
    result, usage_record = await invoke()
    finalize(usage_record)
    return result
```

For each invocation:

1. Serialize the validated input.
2. Estimate input tokens with the deterministic four-characters-per-token estimator and role-specific maximum output.
3. Calculate the estimate from the catalog.
4. Reserve the estimate before constructing/running the provider call.
5. Open `harmonia.agent.invoke` and `harmonia.model.generate` spans.
6. Add one `harmonia.agent.delegate` event with specialist and model identifiers.
7. Accumulate usage metadata from every ADK event.
8. Open `harmonia.output.validate` around Pydantic validation.
9. Finalize the usage record after valid output.
10. On provider failure, preserve the reservation for idempotent retry using the same operation ID; do not create a second reservation.

- [ ] **Step 4: Instrument direct transcription and image generation**

Change `transcribe_audio` and `generate_image` to accept `InvocationContext` and a usage sink. Record provider usage metadata when returned. Image generation uses `unit_type="images"`; until its media rate enters the catalog, the call must use an explicit configured maximum-cost reservation rather than pretending its cost is zero.

- [ ] **Step 5: Add safe span assertions**

Use the in-memory exporter to assert:

- The trace contains agent, delegation, model, and validation spans.
- `job.id`, `stage`, `agent`, `model`, token counts, and cost are present.
- Transcript text, prompts, drafts, and model response bodies do not appear in span names, attributes, or events.
- Malformed output marks validation failure and does not write a successful usage record.

- [ ] **Step 6: Run all Python tests**

Run: `cd agent && ./.venv/bin/python -m pytest tests -q`

Expected: all tests pass; offline fixtures traverse the same reservation and usage normalization through an in-memory sink without contacting Firestore.

- [ ] **Step 7: Commit model instrumentation**

```bash
git add agent/harmonia_agent/agents.py agent/harmonia_agent/content.py agent/harmonia_agent/stages.py agent/tests/test_agent_team.py agent/tests/test_agent_stages.py agent/tests/test_cost_reporting.py
git commit -m "feat(agent): trace and meter model invocations"
```

---

### Task 7: Cost Metrics, Deployment Configuration, and Documentation

**Files:**
- Modify: `src/app/api/metrics/route.ts`
- Modify: `tests/contracts.test.ts`
- Modify: `infra/setup.sh`
- Modify: `infra/deploy.sh`
- Modify: `.env.example`
- Modify: `docs/configuration.mdx`
- Modify: `docs/architecture.mdx`
- Modify: `docs/deployment.mdx`

**Interfaces:**
- Consumes: persisted usage records, job budgets, trace identifiers, and configuration.
- Produces: additive `modelUsage` and `costs` fields in `/api/metrics`, enabled Cloud trace services, and reproducible verification instructions.

- [ ] **Step 1: Add cost aggregation to the metrics response**

Extend `MetricsResponse` with:

```typescript
modelUsage: Array<{
  model: string;
  role: string;
  calls: number;
  inputUnits: number;
  outputUnits: number;
  estimatedCostUsd: string;
}>;
costs: {
  estimatedUsd: string;
  observedUsd: string;
  reservedUsd: string;
};
```

Aggregate with integer microdollars. Keep all existing response fields unchanged.

- [ ] **Step 2: Update cloud setup and deployment**

Enable:

```text
cloudtrace.googleapis.com
telemetry.googleapis.com
monitoring.googleapis.com
logging.googleapis.com
```

Grant the web and worker service identities `roles/cloudtrace.agent`. Set:

```text
HARMONIA_TELEMETRY_ENABLED=1
HARMONIA_TELEMETRY_SAMPLE_RATE=1.0
OTEL_SERVICE_NAME=harmonia-agent or harmonia-web
OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=NO_CONTENT
ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false
MODEL_PRICING_VERSION=2026-08-23
```

Do not enable raw prompt/response capture in deployment scripts.

- [ ] **Step 3: Document configuration and verification**

Document:

- How W3C context crosses Pub/Sub.
- Which spans exist and which content is excluded.
- How pricing versions and microdollar arithmetic work.
- How reservations behave on retry.
- How to locate a trace from a Firestore event trace ID.
- How to compare per-role latency, token usage, and estimated cost.
- That observed billing and application estimates are distinct.

- [ ] **Step 4: Run the complete offline verification suite**

Run:

```bash
npm run lint
npx tsc --noEmit
npm test
cd agent && ./.venv/bin/python -m pytest tests -q
git diff --check
```

Expected: every command exits successfully.

- [ ] **Step 5: Commit metrics and deployment documentation**

```bash
git add src/app/api/metrics/route.ts tests/contracts.test.ts infra/setup.sh infra/deploy.sh .env.example docs/configuration.mdx docs/architecture.mdx docs/deployment.mdx
git commit -m "docs: expose and deploy agent cost observability"
```

---

## Phase Acceptance Criteria

This phase is complete only when all of the following are true:

1. A stage trace can continue from Next.js through Pub/Sub into the Python worker.
2. Agent delegation, model generation, and structured validation appear as nested spans.
3. Traces contain no raw prompts, responses, transcripts, drafts, or media.
4. Every real model invocation reserves budget before dispatch.
5. Every successful invocation writes one immutable, idempotent usage record.
6. Unknown pricing and exceeded budgets stop dispatch visibly.
7. `/api/metrics` reports calls, usage, and estimated cost by role and model.
8. Existing public route shapes and pipeline stages remain compatible.
9. All offline suites pass.
10. Cloud functionality remains unclaimed until a correlated deployed trace and persisted usage record are captured.

## Subsequent Plans

After this phase passes, create and execute these plans against the same approved specification:

1. `2026-08-23-role-routing-multimodal-analysis.md`
2. `2026-08-23-agent-engine-memory-bank.md`
3. `2026-08-23-veo-lyria-generated-media.md`
4. `2026-08-23-cloud-evidence-and-submission.md`

They must consume the trace, usage, pricing, budget, and durable asset interfaces established here rather than duplicating them.
