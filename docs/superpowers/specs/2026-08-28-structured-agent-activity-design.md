# Structured Agent Activity and Errors

## Goal

Give every Harmonia agent handoff, validation outcome, Nova tool call, retry, and human gate a
single safe structured representation that can be persisted and rendered in Monitoring without
turning agents into workflow authorities.

## Contracts

`AgentActivityEvent` is the durable operator-safe record. It contains identity (`jobId`,
`operationId`, `traceId`), sequence context (`stage`, `kind`, `status`, `actor`), participants
(`role`, `fromAgent`, `toAgent`), diagnosis (`code`, `category`, `path`, `publicMessage`,
`retryable`, `attempt`, `maxAttempts`), and bounded tool metadata (`skillName`, `toolName`,
`durationMs`). All content-bearing fields, prompts, responses, transcripts, credentials, provider
bodies, and private reasoning are forbidden.

Agent outputs remain their existing strict success schemas. Invalid output raises a structured
`AgentContractError` carrying a stable code, agent role, safe public message, and optional schema
path. The worker converts it to the existing durable `FailureEnvelope` without exposing raw model
output.

Nova tool results become a strict discriminated `ToolEnvelope`: success requires data and evidence;
error requires a typed `ToolError` and no evidence. Every runtime error code must be declared by the
tool's executable contract. Nova's final typed error retains code, category, message, and retryable.

## Persistence and transport

Firestore remains the source of truth. Existing job event documents are extended cleanly with the
structured fields; no parallel monitoring store is introduced. Web persistence routes emit
structured handoffs only after their corresponding artifact has passed validation and been stored.
The durable failure route emits a structured failed or retrying event from the exact
`FailureEnvelope`.

Nova's read-only ask response includes a sanitized activity trace derived from actual ADK callbacks.
Chat streaming forwards that trace through typed activity/tool events. No tool arguments or returned
records are exposed; only names, status, stable code, attempt, duration, and trace identity appear.

## Monitoring UI

Monitoring gains an **Agents** view. It lists events chronologically with filters for job, agent,
kind, and status. Selecting an event shows its stable code, category, schema path, attempt budget,
tool or skill, trace ID, and safe message. Completed handoffs collapse visually; retries and failures
remain prominent. Empty, loading, and request-failure states are explicit.

## Authority and privacy

Activity events describe observed state; they never advance workflow state. Agent completion does
not imply approval. Human approvals remain digest-bound records. The event schemas reject field
names associated with prompts, responses, content, text, bodies, secrets, tokens, cookies, or
transcripts.

## Verification

Python tests cover structured agent errors, strict tool envelopes, declared error codes, Nova trace
sanitization, and failure normalization. TypeScript tests cover event schema parity, Firestore
round-trips, tenant-scoped API filtering, chat transport, and Monitoring rendering. Full Python,
Vitest, lint, TypeScript, and production-build gates remain required.
