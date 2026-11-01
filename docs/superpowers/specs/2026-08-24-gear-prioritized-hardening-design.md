# GEAR-Prioritized Harmonia Hardening Design

## Purpose

Turn Harmonia's existing production-shaped architecture into a verified, judge-ready Taskmaster submission. The work follows the findings in the private `resources/gear-harmonia-audit.md` rather than treating every course example as a required feature.

The priority is one undeniable real workflow:

`YouTube → Gemini 3.5 → Google ADK / Agent Engine → Firestore + Pub/Sub → human approval → real external effect → idempotent receipt → independent verification`

## Scope and non-goals

This project implements:

1. Authenticated end-to-end evidence for the required vertical slice.
2. ADK-native evaluation of routing, specialist outputs, and tool trajectories.
3. Explicit generation, safety, quality, latency, and cost policy per cognitive role.
4. Targeted hardening of session state, chat history, Memory Bank, tools, typed failures, retry, escalation, recovery, tracing, and operator-facing evidence.
5. Judge-visible documentation of agentic cognition, deterministic workflow, and human authority.

The following remain deferred unless a measured requirement makes them necessary after the core slice passes: MCP, Google Search, Drive, Calendar, `BuiltInPlanner`, Veo/Lyria, and additional publishing platforms. Deferral is an architectural decision, not an implementation gap.

## Existing foundations to preserve

- Firestore is the source of truth for jobs, actions, approval decisions, receipts, usage, failures, and verification.
- Pub/Sub drives resumable stage transitions and redelivery.
- Google ADK and Agent Engine own bounded cognitive turns, not durable business-process control.
- Memory Bank contains only eligible, evidence-linked preferences and verified learnings.
- Side-effecting actions require explicit operator approval.
- Stable idempotency keys prevent duplicate effects.
- OpenTelemetry contains execution metadata, never prompts, transcripts, drafts, media bytes, or hidden chain-of-thought.
- Test fixtures and `HARMONIA_MOCK_AI=1` remain development-only and cannot produce submission evidence.

## Architecture

### 1. Vertical-slice proof harness

Add a private evidence runner outside the public repository that invokes the deployed application with one authorized YouTube source and records immutable source metadata, Cloud Run revision, Agent Engine resource, model IDs, Firestore job/event identifiers, Pub/Sub message identifiers, approval record, effect receipt, verification result, trace identifiers, timings, and itemized cost.

The public repository provides deterministic verification commands and schemas. Credentials, raw transcripts, private logs, screenshots, and execution exports remain under parent-level `submission/` or `evidence/` directories.

No stage may translate an unavailable provider, missing credential, policy rejection, or failed external effect into success. An exported content pack is an acceptable real effect only when it contains actual Gemini-derived artifacts and its stored digest is independently verified.

### 2. State, history, and memory boundaries

Firestore remains authoritative for operational state. ADK session state contains only serializable invocation context and typed handoffs written through `output_key`, event `state_delta`, `CallbackContext`, or `ToolContext`. Retrieved session objects are read-only outside the managed event lifecycle.

Conversation history is scoped by workspace, authenticated operator, interface, and conversation ID. The application enforces maximum retained turns and explicit summarization boundaries without copying approval authority or operational truth into model history.

Memory Bank records only scoped preferences, explicit approval/rejection feedback, verified outcomes, and aggregate learnings. Every memory record references durable Firestore evidence and its workspace/brand scope. Memory failure is visible but cannot roll back an already verified external effect.

### 3. Typed failures and recovery

All worker stages, provider adapters, and agent-exposed tools map failures into a shared contract:

- `validation`: malformed or schema-invalid data; permanent.
- `authorization`: missing or insufficient identity/permission; permanent until configuration changes.
- `policy`: approval, safety, regional, or platform policy rejection; permanent until operator action.
- `budget`: unknown price or insufficient authorized budget; permanent until budget/configuration changes.
- `provider_transient`: timeout, 429, or retryable 5xx; bounded retry.
- `provider_permanent`: provider rejection or unsupported request; permanent.
- `dependency`: unavailable required system with explicit retry classification.
- `protocol`: invalid provider/tool/agent response; permanent and evidence-preserving.

Each failure includes a safe public message, internal code, retryability, stage, operation ID, trace ID, and sanitized details. Retry decisions are centralized, bounded, and idempotent. Permanent failures remain visible and can be retried only through the existing operator endpoint after the cause is corrected. Human escalation creates no external effect by itself.

### 4. Role generation, safety, and cost policy

Each role configuration contains model resource, provider, maximum output tokens, temperature, top-p/top-k when supported, safety settings, timeout, task eligibility, pricing catalog version, and evaluation thresholds. Configuration is versioned and recorded with every invocation.

Model choice follows real evaluations on the demo source. The baseline compares candidate models on schema validity, grounding, reference preservation, routing/tool trajectory, latency, and estimated/observed cost. A cheaper model is selected only when it meets the role's threshold.

Cost reservation occurs before dispatch. Final usage is immutable and linked to job, stage, role, model configuration, pricing version, operation ID, and trace. Unknown pricing is not budget-authorized. Cost skills are read-only views over persisted records and never estimate from prose or model recall.

### 5. Tool and skill contracts

Every ADK-exposed tool has a contract declaring its verb-noun name, purpose, input types, return schema, error codes, permission level, data scope, timeout, retry behavior, and external-effect classification. Tool outputs use consistent `status`, `data`, and `error` envelopes.

The coordinator and insight roles receive only the minimum read-only tools needed for their tasks. Publishing, approval decisions, credential mutation, destructive operations, and budget changes are never agent tools. Skills must instruct the agent to load the relevant skill, call only allowed tools, cite returned evidence, and report absence/failure honestly.

MCP is not part of the required implementation. If later adopted, it must use an authenticated remote server, an explicit tool allow-list/filter, tenant-scoped credentials, read-only capability for the first integration, and the same tool envelope. MCP failure cannot block the core slice.

### 6. ADK evaluation and conformance

Create a public evaluation structure without private source content and private parent-level eval inputs/results for the authorized demo video. Evaluation cases cover:

- coordinator selects exactly the requested specialist;
- analyst moments are timestamp-bounded and grounded in supplied evidence;
- copywriter references only supplied moment/angle IDs and respects platform limits;
- editor preserves retained IDs and cannot invent new drafts;
- planner reproduces reviewed text exactly and cannot approve or execute;
- presenter uses only allowed components and persisted references;
- liaison selects the correct read-only skill/tool and cites tool output;
- invalid schemas and prohibited authority produce explicit failures.

Where supported by the installed ADK version, record golden conformance sessions and compare expected versus actual agent/tool trajectories. Otherwise, retain the same evalset semantics in versioned Pydantic-backed fixtures and document the precise compatibility limitation. Real-model results, not scripted fixtures, determine the submission claims.

### 7. Observability and judge-facing evidence

W3C trace lineage connects authenticated web requests, Pub/Sub publication/delivery, stage execution, Agent Engine invocation, specialist delegation, model usage, validation, approval wait, external effect, receipt, and verification. Separate inbound requests—such as operator approval and replay proof—correctly start separate traces. Firestore records retain trace and operation identifiers so cognition links to lifecycle events while approval, claim, effect, and verification share the action trace.

The architecture documentation contains three matrices:

1. Role contract: model, input/output, tools, state, authority, evaluation.
2. State ownership: store, scope, lifetime, writer, reader, retention, source-of-truth status.
3. Tool contract: inputs, outputs, errors, permissions, retries, and side effects.

The four-minute demo shows the startup content problem, one uninterrupted workflow, an approval decision, the real effect, independent verification, cost, and trace evidence. Bonus capabilities appear only after the core proof.

## Delivery projects

### Project A — Evaluation and configuration foundation

Add role generation/safety configuration, real-source eval schemas, trajectory assertions, and model/cost comparison reports. This comes first because later changes need measurable acceptance criteria.

### Project B — State, history, memory, and failure hardening

Enforce state-write boundaries, conversation retention/scope, evidence-linked Memory Bank records, shared failure envelopes, and centralized retry decisions.

### Project C — Tool and skill contracts

Normalize exposed tools, validate permissions and envelopes, and add selection/grounding/escalation evaluations. MCP remains an explicit post-core decision.

### Project D — End-to-end evidence and documentation

Run the authenticated cloud slice, capture private evidence, generate the three public matrices, verify the demo commands, and reconcile every GEAR/hackathon requirement.

Each project must leave the repository buildable and testable and ends in a coherent commit. Production code follows red-green-refactor: a failing behavioral test precedes each change.

## Acceptance criteria

1. A real authorized YouTube job completes through an authenticated Gemini 3.5 and ADK/Agent Engine path.
2. Firestore and Pub/Sub evidence proves durable progression and retry-safe behavior.
3. No external effect executes without a durable approval record.
4. Replaying an executed action produces `already_applied`, not a duplicate effect.
5. Independent verification confirms the real effect or preserves an honest failure.
6. Every cognitive role has explicit generation/safety configuration and an evaluation-backed model choice.
7. ADK evalsets cover routing, grounding, schemas, preservation, non-authority, and tool trajectory.
8. Session, history, Firestore, and Memory Bank scopes cannot leak across workspaces.
9. Exposed tools have validated least-privilege contracts and typed failures.
10. One correlated trace and itemized cost report cover the complete demonstrated job without private content.
11. Public documentation accurately distinguishes implemented, verified, deferred, and externally blocked capabilities.
12. TypeScript tests, Python tests, scoped lint, production build, and evidence verification commands pass at final audit.
