# Harmonia A2UI Chat Console Design

## Goal

Give Harmonia's full Chat Console a production-grade generative interface inspired by the interaction patterns in Vercel AI Elements while remaining on Google ADK, Google's A2UI protocol, React, Cloud Storage, Firestore, and the existing approval pipeline.

## Scope

The full Console receives streaming messages, safe agent activity, attachments, confirmations, context usage, citations, plans, queues, tool activity, tasks, and A2UI surfaces. The floating Drawer reuses only message, attachment, and confirmation rendering. Vercel AI SDK and AI Elements are not dependencies.

## Architecture

The existing `POST /api/chat` JSON contract remains available for Telegram and compatibility. The Console uses `POST /api/chat/stream`, which emits newline-delimited, schema-validated `ChatStreamEvent` records. A2UI operations are one event kind and are processed only by the official A2UI web core and React renderer.

The A2UI renderer targets protocol v0.9 and a versioned Harmonia catalog. The catalog contains trusted React renderers for `ActivityTrace`, `ReasoningSummary`, `AttachmentCard`, `InlineCitation`, `PlanView`, `QueueView`, `ToolActivity`, `TaskView`, `ContextUsage`, and `MessageContent`. Unknown components and malformed messages fail closed.

Conversation scrolling, reconnection, upload controls, and confirmation authority remain host-owned React behavior. Agent output can describe a confirmation request but cannot manufacture an executable operation. Approval buttons require an existing tenant-scoped server operation or existing Harmonia action ID.

## Safety Boundary

`ActivityTrace` and `ReasoningSummary` expose concise summaries, delegation, evidence, tool status, and actual execution progress. They never expose hidden model reasoning or raw provider thought tokens.

A2UI is declarative data. The renderer accepts no agent-provided JavaScript, HTML, CSS, arbitrary component names, arbitrary action handlers, or unvalidated URLs. Citation URLs allow only HTTP(S); attachment previews use same-origin authorized routes.

Existing publish, media, and content-pack actions continue through their durable action IDs, decision endpoints, receipts, and idempotency rules. Generic future confirmations resolve a server-created pending operation, validate its tenant, expiry, current state, and registered handler, then record a single-use decision.

## Attachments

The composer accepts real image, video, audio, and document files. Production uploads go directly from the browser to tenant-scoped Cloud Storage through short-lived resumable upload sessions. The server validates filename, MIME type, size, tenant, and object destination before creating the session, then independently verifies object metadata before marking an attachment ready. Local development uses an authenticated local upload path with the same state transitions.

Uploads alone cause no workflow side effect. A submitted message references ready attachment IDs. The coordinator receives sanitized metadata and internal object references and returns a typed disposition: `analyze`, `reference`, `transcribe`, `ingest`, or `ignore`. Deterministic application code validates any proposed job command before creating a job.

## Streaming and Persistence

The stream event union is `run_started`, `text_delta`, `activity`, `tool_activity`, `a2ui_operation`, `confirmation_requested`, `job_updated`, `run_completed`, and `run_failed`. Each submitted prompt creates a durable chat run. Events receive monotonic sequence numbers and are stored before delivery so the client can reconnect after its last sequence. A disconnected browser does not cancel server work; the Console can stop local consumption without rolling back an already accepted job or decision.

Only validated final messages and A2UI surfaces are added to normal conversation history. Firestore gains tenant-scoped `chatAttachments`, `chatRuns`, `chatRunEvents`, and `pendingOperations` records without changing existing job, action, receipt, Pub/Sub, or chat-message document shapes.

## Component Mapping

| AI Elements reference | Harmonia equivalent |
| --- | --- |
| Chain of Thought | `ActivityTrace` with safe summaries and real progress |
| Attachments | trusted resumable composer plus `AttachmentCard` |
| Confirmation | trusted confirmation bound to a server operation |
| Context | `ContextUsage` for model, tokens, context, cache, and cost |
| Conversation | host-owned React conversation shell |
| Inline Citation | validated `InlineCitation` |
| Message | shared `MessageContent` renderer |
| Plan | `PlanView` |
| Queue | Firestore-backed `QueueView` |
| Reasoning | `ReasoningSummary`, never hidden reasoning |
| Tool | `ToolActivity` with sanitized input and output summaries |
| Task | `TaskView` with status and optional job/stage reference |

## Error Handling

Malformed protocol records, unknown catalog components, invalid citations, missing attachment records, stale confirmations, and schema violations are visible permanent protocol errors. Provider and transport failures remain retryable where the existing pipeline permits them. Real failures never become mock or simulated success.

## Testing

Tests validate every event schema variant, reject unsafe URLs and unknown actions, prove confirmation decisions cannot be replayed or crossed between tenants, verify attachment lifecycle and object metadata checks, verify stream sequence and reconnection behavior, and exercise the shared rendering model used by both Console and Drawer. Existing TypeScript, web, and Python suites remain required.
