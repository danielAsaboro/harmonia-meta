# ADK Observability and Agent Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Export Google ADK logs, metrics, and traces with content capture disabled and provide a safe tenant-scoped, filtered, cursor-paginated agent-activity dashboard.

**Architecture:** ADK configures standard OpenTelemetry Google Cloud exporters while Harmonia emits a separate allow-listed activity projection to an authenticated internal route. Firestore stores the projection under the active tenant; a cursor API and monitoring component expose logs, trace relationships, and aggregate metrics without querying cloud telemetry from the browser.

**Tech Stack:** Google ADK 2.x, OpenTelemetry, Google Cloud Logging/Monitoring/Trace exporters, Python/FastAPI/Pydantic, Next.js/TypeScript/Zod, Firestore, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-08-28-adk-observability-design.md`

## Global Constraints

- Keep `OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=NO_CONTENT` and `ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS=false`.
- Never project prompts, responses, transcripts, drafts, media, tool arguments/results, session state, credentials, provider bodies, exception messages, or chain-of-thought.
- Firestore job/approval/receipt/verification records remain authoritative; observability records cannot advance workflow.
- All persistence and reads derive tenant identity server-side.
- Metric dimensions exclude workspace, job, invocation, trace, and span IDs.
- No paid cloud calls, deployment, publishing, or authenticated telemetry capture.
- Preserve unrelated tracked and untracked files.

---

### Task 1: Configure all native ADK OpenTelemetry signals

**Files:**
- Modify: `agent/harmonia_agent/telemetry.py`
- Modify: `agent/harmonia_agent/config.py`
- Modify: `agent/harmonia_agent/main.py`
- Modify: `agent/requirements.txt`
- Modify: `agent/harmonia_agent/agent_engine_deploy.py`
- Test: `agent/tests/test_telemetry.py`
- Test: `agent/tests/test_team_runtime.py`

**Interfaces:**
- Consumes: `settings().telemetry_enabled`, Google ADK telemetry helpers, existing W3C propagation.
- Produces: `configure_telemetry(*, exporters=None, force=False)`, configured tracer/logger/meter providers, metadata-only resource attributes.

- [ ] **Step 1: Write failing exporter and privacy tests**

```python
def test_adk_cloud_exporters_enable_logs_metrics_and_traces(monkeypatch):
    captured = {}
    monkeypatch.setattr(telemetry, "get_gcp_exporters", lambda **kw: captured.update(kw) or "exporters")
    monkeypatch.setattr(telemetry, "maybe_set_otel_providers", lambda exporters: captured.update(value=exporters))
    telemetry.configure_adk_telemetry(force=True)
    assert captured == {
        "enable_cloud_logging": True,
        "enable_cloud_metrics": True,
        "enable_cloud_tracing": True,
        "value": ["exporters"],
    }

def test_adk_telemetry_never_captures_message_content(monkeypatch):
    telemetry.configure_adk_telemetry(force=True)
    assert os.environ["OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT"] == "NO_CONTENT"
    assert os.environ["ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS"] == "false"
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_telemetry.py tests/test_team_runtime.py -q`

Expected: FAIL because all-signal ADK configuration does not exist.

- [ ] **Step 3: Implement ADK exporter setup without breaking injected trace exporters**

Use `google.adk.telemetry.google_cloud.get_gcp_exporters` and
`google.adk.telemetry.setup.maybe_set_otel_providers`. Preserve the existing
in-memory `SpanExporter` path for deterministic trace tests. Add resource
attributes through `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES`, set
production logging to `INFO`, and initialize before the FastAPI app starts.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_telemetry.py tests/test_team_runtime.py -q`

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/telemetry.py agent/harmonia_agent/config.py agent/harmonia_agent/main.py agent/requirements.txt agent/harmonia_agent/agent_engine_deploy.py agent/tests/test_telemetry.py agent/tests/test_team_runtime.py
git commit -m "feat: configure ADK observability signals"
```

### Task 2: Define and emit the safe agent-activity projection

**Files:**
- Create: `agent/harmonia_agent/activity_models.py`
- Create: `agent/harmonia_agent/activity_projection.py`
- Modify: `agent/harmonia_agent/web_client.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/nova_liaison.py`
- Test: `agent/tests/test_activity_projection.py`

**Interfaces:**
- Consumes: `InvocationContext`, current span context, validated specialist result, normalized Nova tool trace.
- Produces: strict `AgentActivityRecord`, `project_agent_invocation(...)`, and `web_client.record_agent_activity(record)`.

- [ ] **Step 1: Write failing strict-model and redaction tests**

```python
def test_activity_record_rejects_content_and_unknown_fields():
    payload = valid_activity()
    payload["prompt"] = "private"
    with pytest.raises(ValidationError):
        AgentActivityRecord.model_validate(payload)

def test_failed_projection_records_category_not_exception_message():
    record = failed_agent_activity(context(), ValueError("token=secret"))
    assert record.outcome == "error"
    assert record.errorCategory == "protocol"
    assert "secret" not in record.model_dump_json()
```

- [ ] **Step 2: Run the projection tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_activity_projection.py -q`

- [ ] **Step 3: Implement strict projection types and one-retry delivery**

Define literals for signal type, severity, outcome, agent names, and safe error
categories. Validate UUID/identifier lengths, numeric bounds, ISO timestamps,
trace/span hex formats, and `extra="forbid"`. Construct records only from
explicit parameters. Retry one transient internal HTTP failure and log only
safe IDs on terminal projection failure.

- [ ] **Step 4: Instrument agent success, failure, and Nova tools**

Emit invocation trace/log records after deterministic output validation and on
normalized failures. Emit tool records from Nova's actual callback trace.
Never emit before tenant, job/invocation, and operation context are known.

- [ ] **Step 5: Run projection and agent tests and verify GREEN**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_activity_projection.py tests/test_agent_team.py tests/test_nova_contracts.py -q`

- [ ] **Step 6: Commit**

```bash
git add agent/harmonia_agent/activity_models.py agent/harmonia_agent/activity_projection.py agent/harmonia_agent/web_client.py agent/harmonia_agent/agents.py agent/harmonia_agent/nova_liaison.py agent/tests/test_activity_projection.py
git commit -m "feat: project safe agent activity"
```

### Task 3: Persist and query tenant-scoped activity with stable cursors

**Files:**
- Create: `src/lib/observability/schema.ts`
- Create: `src/lib/observability/repository.ts`
- Create: `src/app/api/internal/observability/route.ts`
- Create: `src/app/api/observability/route.ts`
- Modify: `firestore.indexes.json`
- Test: `tests/observabilitySchema.test.ts`
- Test: `tests/observabilityRepository.test.ts`
- Test: `tests/observabilityRoutes.test.ts`

**Interfaces:**
- Consumes: Python JSON `AgentActivityRecord`, `tenantHandler`, tenant Firestore collections.
- Produces: `agentActivitySchema`, `writeAgentActivity`, `listAgentActivity`, `ObservabilityPage`.

- [ ] **Step 1: Write failing TypeScript parity and route tests**

```typescript
it("rejects content-bearing and unknown activity fields", () => {
  expect(() => agentActivitySchema.parse({ ...validActivity, prompt: "private" })).toThrow();
});

it("returns a stable tenant-scoped cursor page", async () => {
  const first = await listAgentActivity({ limit: 2 });
  const second = await listAgentActivity({ limit: 2, cursor: first.nextCursor! });
  expect(second.items.map((item) => item.id)).not.toContain(first.items[0].id);
});
```

- [ ] **Step 2: Run focused Vitest tests and verify RED**

Run: `npx vitest run tests/observabilitySchema.test.ts tests/observabilityRepository.test.ts tests/observabilityRoutes.test.ts`

- [ ] **Step 3: Implement the strict internal write boundary**

Authenticate the worker token, derive workspace and brand from headers, parse
the strict schema, require payload workspace/brand equality, generate the
server record ID, and persist a retention timestamp. Return 201 with the ID.

- [ ] **Step 4: Implement ordered cursor queries and filters**

Use `occurredAt desc` plus document ID ordering, fetch `limit + 1`, encode the
last timestamp and ID in base64url JSON, and validate cursor shape before
`startAfter`. Apply exact filters through Firestore; apply bounded safe search
to the fetched candidate window. Return facets derived from the page and never
cross-tenant totals.

- [ ] **Step 5: Add required composite indexes and verify GREEN**

Run: `npx vitest run tests/observabilitySchema.test.ts tests/observabilityRepository.test.ts tests/observabilityRoutes.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/observability src/app/api/internal/observability src/app/api/observability firestore.indexes.json tests/observabilitySchema.test.ts tests/observabilityRepository.test.ts tests/observabilityRoutes.test.ts
git commit -m "feat: query tenant agent activity"
```

### Task 4: Build the paginated and filtered activity interface

**Files:**
- Create: `src/components/monitoring/AgentActivityView.tsx`
- Create: `src/components/monitoring/ActivityFilters.tsx`
- Create: `src/components/monitoring/TraceTree.tsx`
- Create: `src/components/monitoring/ActivityMetrics.tsx`
- Modify: `src/app/dashboard/monitoring/page.tsx`
- Test: `tests/agentActivityView.test.tsx`
- Test: `tests/activityMetrics.test.ts`

**Interfaces:**
- Consumes: `GET /api/observability` response and URL search parameters.
- Produces: logs/traces/metrics views, filter controls, detail expansion, cursor history.

- [ ] **Step 1: Write failing component and metric tests**

```typescript
it("resets cursor history when a filter changes", async () => {
  render(<AgentActivityView />);
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.selectOptions(screen.getByLabelText("Agent"), "ryan_strategist");
  expect(lastRequestedUrl()).not.toContain("cursor=");
});

it("groups safe activity into agent latency and token summaries", () => {
  expect(summarizeActivity(records).agents[0]).toMatchObject({
    agent: "ryan_strategist", invocations: 2, inputTokens: 120,
  });
});
```

- [ ] **Step 2: Run component tests and verify RED**

Run: `npx vitest run tests/agentActivityView.test.tsx tests/activityMetrics.test.ts`

- [ ] **Step 3: Implement URL-backed filters and cursor history**

Provide signal, agent, stage, outcome, severity, model, tool, job, trace, time,
and safe-search controls. Debounce text search, reset cursors on filter changes,
and keep Previous cursors in component state. Render explicit request failures.

- [ ] **Step 4: Implement logs, trace tree, metrics, and safe detail view**

Build trace hierarchy from `spanId`/`parentSpanId`, calculate p50/p95 from the
current filtered window, and display only schema fields. Add Cloud console links
with `rel="noreferrer"`. Preserve the existing monitoring tabs and add
`Agent activity` without deleting workflow logs.

- [ ] **Step 5: Run component tests and verify GREEN**

Run: `npx vitest run tests/agentActivityView.test.tsx tests/activityMetrics.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/components/monitoring/AgentActivityView.tsx src/components/monitoring/ActivityFilters.tsx src/components/monitoring/TraceTree.tsx src/components/monitoring/ActivityMetrics.tsx src/app/dashboard/monitoring/page.tsx tests/agentActivityView.test.tsx tests/activityMetrics.test.ts
git commit -m "feat: add agent activity explorer"
```

### Task 5: Document, verify, and finish the isolated branch

**Files:**
- Modify: `docs/observability.mdx`
- Modify: `docs/agent-platform.mdx`
- Modify: `docs/configuration.mdx`
- Modify: `docs/deployment.mdx`
- Modify: `README.md`
- Test: all project suites

**Interfaces:**
- Consumes: implemented configuration, API, and dashboard behavior.
- Produces: accurate operator and deployment documentation with official ADK links.

- [ ] **Step 1: Update documentation**

Document the three ADK signal schemas, environment settings, content-exclusion
policy, Firestore projection, filters, pagination, retention, cloud readiness,
and the distinction between telemetry and workflow audit truth.

- [ ] **Step 2: Run the complete Python suite**

Run: `cd agent && ./.venv/bin/python -m pytest tests -q`

- [ ] **Step 3: Run the complete application suite**

Run: `npm test -- --run`

- [ ] **Step 4: Run static and production checks**

Run: `npm run lint`

Run: `npx tsc --noEmit`

Run: `npm run build`

- [ ] **Step 5: Inspect the final change**

Run: `git diff --check`

Run: `git status --short`

Run: `git diff --stat HEAD~5..HEAD`

Review every activity field against the prohibited-content list, every route
against tenant scoping, and every Firestore query against its index.

- [ ] **Step 6: Commit documentation and verification changes**

```bash
git add README.md docs/observability.mdx docs/agent-platform.mdx docs/configuration.mdx docs/deployment.mdx
git commit -m "docs: explain ADK observability"
```
