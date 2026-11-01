# ADK observability and agent activity design

## Goal

Harmonia will export Google ADK logs, metrics, and traces through standard
OpenTelemetry while presenting a safe, tenant-scoped, paginated agent-activity
view inside the dashboard. Firestore remains workflow truth; telemetry remains
diagnostic evidence and cannot authorize or advance work.

## Official ADK signal contract

The Python worker uses ADK's programmatic telemetry setup and Google Cloud
exporters for Cloud Logging, Cloud Monitoring, and Cloud Trace. The exported
signals follow ADK's OpenTelemetry GenAI semantic conventions:

- agent, workflow, tool, and model spans;
- agent, workflow, tool, and model duration histograms;
- inference-call and tool-call histograms;
- input/output token-usage histograms;
- structured GenAI lifecycle logs.

`OTEL_SERVICE_NAME` identifies the worker. Resource attributes include the
Google Cloud project, service version, and deployment environment. W3C trace
context continues across the Next.js control plane, Pub/Sub, worker, Agent
Engine, and internal HTTP calls.

## Privacy and cardinality

Production uses `INFO`; message-content capture remains `NO_CONTENT`. Harmonia
does not export or project prompts, responses, system instructions,
transcripts, drafts, media, tool arguments or results, session state,
credentials, authorization headers, private reasoning, or provider bodies.

Attributes are allow-listed. IDs needed for correlation may be high-cardinality
on logs and spans, but metric dimensions remain bounded to agent, operation,
workflow, tool, model, token type, outcome, and safe error category. Workspace,
job, invocation, trace, and span IDs never become metric dimensions.

## Safe activity projection

The worker sends one metadata-only `AgentActivityRecord` to an authenticated
internal web route when a Harmonia-managed agent invocation completes or
fails. Tool activity is projected from observed ADK tool callbacks. The web
route validates the strict payload and writes it under the active tenant's
Firestore `agentActivity` collection.

Each record contains:

- immutable record ID and schema version;
- `occurredAt`, `signalType`, `eventName`, `severity`, and `outcome`;
- agent, stage, operation, workflow, model, and optional tool name;
- job, invocation, trace, span, and parent-span correlation IDs;
- bounded duration, input/output tokens, inference count, and tool-call count;
- one safe error category and error type, never an exception message;
- telemetry backend and an optional server-generated Google Cloud console URL.

The projection does not copy arbitrary OpenTelemetry logs or span attributes.
It is an application-owned read model derived from allow-listed runtime facts.
Failure to write observability data is visible in worker logs but does not
convert successful workflow work into failure or advance workflow state.

## Query API

`GET /api/observability` is authenticated and tenant-scoped. It accepts:

- `types` (`log`, `trace`, `metric`);
- `agent`, `stage`, `outcome`, `severity`, `model`, and `tool`;
- exact `jobId` and `traceId`;
- `since` and `until` ISO timestamps;
- bounded identifier/name search;
- `limit` from 10 through 100;
- an opaque cursor created by the server.

Firestore performs the primary ordered query by `occurredAt desc` and document
ID. The cursor encodes only the final timestamp and document ID and is signed
or structurally validated before use. Filters are applied server-side. The
response contains `items`, `nextCursor`, `hasMore`, and filter facets. No API
returns a cross-tenant count or accepts workspace identity from query params.

The initial implementation uses forward cursor pagination. The client keeps a
cursor history to implement Previous without reverse Firestore queries.

## Dashboard

Monitoring gains an **Agent activity** tab with URL-backed filters and three
views:

1. **Logs** — lifecycle and safe failure events.
2. **Traces** — invocation rows expandable into the recorded agent/tool
   hierarchy, correlated by trace and parent-span IDs.
3. **Metrics** — summaries computed from the returned safe activity window:
   invocation count, success rate, latency percentiles, tokens, tool calls,
   and grouped agent/model/tool tables.

The page shows active filters, reset controls, explicit loading/empty/error
states, result range, and Previous/Next controls. A record detail drawer shows
all safe fields and a Cloud console link when configured. Search and filter
changes reset pagination.

## State ownership and retention

Cloud Logging, Monitoring, and Trace own exported telemetry. Firestore owns the
tenant-facing activity projection and applies the existing retention policy.
Job events, approvals, commands, receipts, and verification records remain the
authoritative audit trail. Activity records cannot be used as approvals,
receipts, verification, Memory Bank evidence, or replay authority.

## Failure behavior

- Invalid activity writes fail closed with a typed 400 response.
- Unauthorized or cross-tenant reads return no records and cannot probe
  existence.
- Malformed or expired cursors return 400.
- Exporter initialization failure prevents a cloud-mode worker from claiming
  telemetry readiness; explicit local telemetry-off mode remains supported.
- Projection delivery failure is logged with safe identifiers and may retry
  once when the internal endpoint reports a transient error.
- UI request failures remain visible and never display fabricated empty data.

## Testing and verification

- Python tests cover ADK exporter configuration, content capture disabled,
  resource attributes, safe projection construction, success/failure records,
  tool hierarchy, and redaction.
- TypeScript tests cover strict schema parity, tenant-scoped persistence,
  cursor validation, pagination stability, every filter, and route errors.
- Component tests cover URL filters, pagination reset/history, empty/error
  states, metric summaries, trace expansion, and safe details.
- Full Python and Vitest suites, ESLint, `tsc --noEmit`, production build, and
  `git diff --check` must pass before completion.

No paid cloud calls, deployment, or authenticated telemetry capture are part
of this implementation task.
