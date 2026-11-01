# Durable Agent Runtime Design

**Date:** 2026-08-28  
**Status:** Approved direction; implementation specification  
**Scope:** Harmonia's Google-native long-running, event-driven content workflow

## Objective

Harmonia must continue an operation safely across process exits, retries, delayed external events, context compaction, worker replacement, and multi-day pauses. It must retain enough evidence to reconstruct every important decision while keeping each model invocation bounded. It must never infer external-effect success from missing data, let a stale worker commit after losing ownership, or let compacted conversation text become the only source of policy or approval authority.

The implementation extends the existing Firestore, Pub/Sub, Cloud Run, Google ADK, Agent Engine, Memory Bank, GCS, approval, receipt, verification, replay, and observability architecture. It does not introduce a second workflow engine.

## Existing foundations retained

The repository already implements important parts of the target runtime:

- Firestore is the authoritative workflow store and Pub/Sub is a trigger transport.
- Jobs carry versioned strategy, editorial-plan, analysis, draft, approval, and stage state.
- Stage outbox records atomically accompany stage transitions.
- Stage execution leases represent `claimed`, `applied`, `failed`, and `uncertain` states.
- Effect commands bind immutable canonical payload digests to an approval or mandate.
- Effect claims, receipts, verification, and replay observations preserve external-action evidence.
- Google ADK agents use typed role contracts and source-bound evidence.
- Memory Bank facts are tenant-scoped, provenance-bound, and non-authoritative.
- GCS-backed asset storage, OpenTelemetry traces, cost reservations, record/replay, retention, and operator monitoring already exist.

The new runtime converges these mechanisms around a canonical operation ledger, durable event inbox, fencing epochs, explicit dispatch ambiguity, artifact-backed context projections, and recovery decisions.

## Rejected approaches

### Replace the runtime with Temporal, Restate, or another workflow engine

This would duplicate Firestore state, complicate the existing Cloud Run/ADK boundary, and weaken the required Google-native architecture. A durable workflow engine would still not solve model context construction or arbitrary third-party effect atomicity.

### Add only conversation summarization or vector memory

This would reduce prompt pressure without solving duplicate event acceptance, crash ambiguity, stale workers, approval enforcement, or revision correctness.

### Preserve the current leases without fencing

Owner tokens prevent one worker from releasing another worker's claim, but an expired worker can still perform a late write. A monotonic epoch checked at every protected mutation is required.

## System model

The canonical unit of execution is an `OperationRecord`, not an ADK session or chat conversation. A job may create multiple operations for stages, effects, verifications, event wakes, or recovery. Chat, Telegram, Pub/Sub, timers, approvals, and provider callbacks are event sources that correlate to operations.

The runtime maintains four separate history representations:

1. Canonical events and evidence for audit.
2. Typed mutable operation state for recovery.
3. Versioned bounded context projections for model calls.
4. GCS artifacts for large payloads with Firestore metadata.

## Firestore records

All new record families live under `workspaces/{workspaceId}` and include `workspaceId` and `brandId`. Existing tenant helpers remain mandatory.

### `operations/{operationId}`

```ts
type OperationKind =
  | "stage"
  | "effect"
  | "verification"
  | "event_wake"
  | "context_projection"
  | "recovery";

type OperationState =
  | "planned"
  | "runnable"
  | "claimed"
  | "waiting"
  | "unknown"
  | "succeeded"
  | "failed"
  | "cancelled";

interface OperationRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  jobId: string;
  kind: OperationKind;
  state: OperationState;
  goal: { type: string; version: number; digest: string; acceptance: string[] };
  causalParentId?: string;
  correlationId: string;
  replayPolicy: "safe" | "reconcile" | "never";
  epoch: number;
  ownerId?: string;
  ownerTokenDigest?: string;
  leaseExpiresAt?: string;
  attempt: number;
  maxAttempts: number;
  budget: {
    tokenLimit?: number;
    toolCallLimit?: number;
    costLimitUsd?: string;
    deadline?: string;
  };
  latestProjectionId?: string;
  unresolvedReason?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

Operation IDs are stable domain identities, such as `job:{jobId}:stage:{stage}` or `job:{jobId}:effect:{commandId}`. Delivery attempts and worker IDs never become operation identities.

### `event_inbox/{eventKey}`

`eventKey` is the SHA-256 digest of canonical `(source, sourceEventId)`. The stored record includes source, source event ID, schema version, correlation and causation IDs, payload digest, artifact reference when the payload is large, trust classification, received/occurred timestamps, operation ID, delivery attempts, and state (`accepted`, `processing`, `completed`, `rejected`).

The inbox answers whether a domain event has been accepted. Pub/Sub message IDs are retained as delivery evidence but do not replace the stable source event ID.

### Existing `stage_outbox/{id}`

Stage outbox records gain:

- `sourceEventId`: stable as `stage-outbox:{id}`;
- `correlationId` and optional `causationId`;
- `schemaVersion`;
- `operationId`;
- `publishAttempt`.

Republishing an ambiguous outbox record may produce multiple Pub/Sub messages, but all carry the same stable source event ID and collapse at the inbox.

### `artifacts/{artifactId}`

```ts
interface ArtifactRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  jobId: string;
  operationId: string;
  uri: string;
  sha256: string;
  contentType: string;
  encoding?: string;
  byteCount: number;
  lineCount?: number;
  itemCount?: number;
  preview: string;
  trust: "system" | "operator" | "provider" | "external_untrusted" | "model_inference";
  sourceEventId?: string;
  producer: { kind: string; id: string; version: string };
  retentionClass: "operational" | "audit" | "source" | "ephemeral";
  expiresAt?: string;
  createdAt: string;
}
```

The GCS object path is tenant-scoped and unpredictable. A client receives an opaque artifact ID, never ambient filesystem authority. Reads verify tenant scope and digest and support bounded byte or line ranges.

### `context_projections/{projectionId}`

```ts
interface ContextProjectionRecord {
  id: string;
  compilerVersion: string;
  workspaceId: string;
  brandId: string;
  jobId: string;
  operationId: string;
  operationEpoch: number;
  model: string;
  goalDigest: string;
  policyVersion: string;
  pinnedConstraintIds: string[];
  approvalIds: string[];
  unresolvedEffectIds: string[];
  currentRevisionRefs: string[];
  evidenceRefs: string[];
  artifactRefs: string[];
  recentEventIds: string[];
  manifestDigest: string;
  renderedDigest: string;
  renderedChars: number;
  createdAt: string;
}
```

The rendered prompt is not required to remain inline. If it exceeds the configured audit threshold, it is stored as an artifact and the projection stores its artifact ID. The manifest remains queryable.

## Event acceptance and wake flow

1. The outbox dispatcher publishes a versioned envelope containing stable `sourceEventId`, tenant scope, job/stage, operation ID, correlation/causation IDs, attempt, and trace context.
2. The Cloud Run worker authenticates the push through IAM and validates data/attribute tenant equality.
3. Before stage dispatch, the worker calls the internal event-inbox claim endpoint.
4. A Firestore transaction creates the inbox record if absent and creates or validates the correlated operation. An already completed event returns `already_completed`; an active event returns `in_progress`; a retryable abandoned event can be reclaimed only under its replay policy.
5. The worker claims the operation, receiving a monotonically increasing epoch.
6. The worker compiles and persists the model projection, executes the bounded transition, and sends the operation ID and epoch on every protected internal mutation.
7. Finalization atomically records terminal stage/operation state and inbox completion. A transient failure leaves the event retryable; permanent or ambiguous outcomes are visible records rather than successful acknowledgements.

Malformed or unauthorized messages are rejected and acknowledged to prevent poison redelivery, with sanitized observability evidence. Authenticated transient failures are negatively acknowledged.

## Fencing and ownership

Each successful operation claim increments `epoch`. Reclaim is permitted only after lease expiry and according to replay policy:

- `safe`: claim a new epoch and retry from the last durable checkpoint;
- `reconcile`: move to `unknown` and run a reconciler before any new dispatch;
- `never`: remain unresolved until an operator decision.

The worker sends `x-harmonia-operation-id` and `x-harmonia-operation-epoch` on protected internal requests. `internalRoute` gains an explicit `requireFence` option. When required, it loads the operation in the same transaction or performs a precondition check and rejects stale, terminal, or wrong-tenant epochs.

Stage mutation routes, effect-dispatch transitions, receipt finalization, verification writes, and context-projection writes require a fence. Control-plane claim/recovery endpoints do not require a pre-existing fence because they issue or replace one.

Fencing protects Harmonia's Firestore authority. A provider that cannot validate epochs still requires the effect-command protocol below.

## External-effect protocol

Existing effect commands remain immutable and approval/mandate-bound. Their state expands additively:

```text
pending (authorized intent)
  -> claimed/prepared
  -> dispatched
  -> observed
  -> applied | failed | unknown
  -> verified (separate verification record)
```

The provider boundary follows this sequence:

1. Validate command digest, approval/mandate, tenant, operation epoch, budget, and adapter availability before dispatch.
2. Commit `prepared` ownership and an attempt record.
3. Immediately before the external request, persist `dispatched` with operation epoch, provider, idempotency key, and timestamp.
4. Execute the official provider API with its idempotency/client reference where supported.
5. Persist the observed response and receipt atomically with command/job state.
6. Run independent verification by official API readback or artifact digest reread.

Any ordinary exception after `dispatched` becomes `unknown`, not `failed`. Only a typed `ProviderEffectNotStarted` raised before request transmission may safely return the command to a retryable prepared state. A provider-declared rejection with a definite response becomes a failed receipt. Unknown outcomes are resolved by provider lookup, idempotent retry, compensation, or authenticated operator decision; they are never blindly replayed.

An approval continues to bind the exact action payload digest. The effect operation additionally records the approval ID and the epoch at which dispatch was authorized. A new payload or expired approval creates a new command/operation rather than mutating the old intent.

## Context compiler

Google ADK session history and Memory Bank remain useful inputs, not authority. Before every model decision, a deterministic compiler builds a typed `DecisionContext` in this order:

1. current goal contract and acceptance criteria;
2. system-declared noncompactable policy constraints;
3. current operation state, epoch, budget, and deadline;
4. approval receipts relevant to the requested decision;
5. unresolved external effects and required reconciliation;
6. current strategy/editorial/draft revisions, excluding superseded revisions from the current-state section;
7. selected evidence with trust and provenance labels;
8. bounded Memory Bank facts with evidence references;
9. recent raw lifecycle events;
10. artifact previews and opaque retrieval references.

The compiler enforces per-section character budgets and a total budget. It never summarizes policy, approval, unresolved ambiguity, goal acceptance criteria, or current revision identity. Oversized evidence is spilled before prompt construction. A projection manifest records every selected input, compiler version, digests, and omissions.

External content is delimited and labelled `external_untrusted`; model output and Memory Bank facts are labelled as inference/advisory. Neither can authorize a tool.

The initial integration covers every stage-level ADK invocation and chat agent run. Provider-specific prompt caching may optimize the rendered projection later, but cannot change its canonical manifest.

## Artifact retrieval

The worker receives a bounded retrieval interface:

- get metadata by artifact ID;
- read a bounded byte or line range;
- search text artifacts for a bounded number of matches;
- verify the returned digest/segment lineage.

Retrieval requires tenant and active operation scope. Retrieved bytes re-enter the context as untrusted evidence and generate an audit event. Secrets, credential envelopes, and redacted fields are ineligible for artifact spill.

## Recovery controller

The resident heartbeat gains a real recovery arm. The control plane queries indexed bounded pages for:

- expired safe operation leases;
- reconcile-policy operations in `unknown`;
- accepted/processing inbox events without a live operation;
- pending or expired outbox claims;
- prepared effect commands not dispatched;
- dispatched effects without observed outcome;
- applied receipts awaiting verification;
- projections whose referenced artifacts are missing or expired.

The controller returns typed recovery actions. Safe stage work is re-enqueued with the same source event identity and a new operation epoch. Unknown effects are sent to provider-specific reconciliation or operator attention. Missing verification creates a verification operation. Recovery actions are idempotent and retain `recoveryOfOperationId` lineage.

Queries are keyset-paged and capped per tick. Recovery cost must be proportional to pending work, not complete historical volume.

## Human approval and ambiguity resolution

Dashboard and Telegram continue to use the same decision service. Approval and ambiguity resolution require authenticated tenant membership, exact payload/effect digest, operation ID, expected state, and expiry. An operator can choose:

- `confirm_applied` with provider evidence;
- `confirm_not_applied` and permit a new idempotent attempt;
- `compensate` through a separately approved command;
- `cancel` while preserving the historical unknown record.

The model may explain the ambiguity but cannot resolve it.

## Observability and operator surface

The existing monitoring API and UI gain operation-level records and filters for `unknown`, stale-epoch rejection, recovery, context projection, and artifact retrieval. Job detail shows:

- active operation and epoch;
- latest context projection manifest;
- pending/reconciled unknown effects;
- event inbox/outbox lineage;
- receipt and verification chain;
- recovery attempts and operator decisions.

No raw prompt, transcript, credential, or artifact body is placed in telemetry.

## Failure behavior

- Database contention retries only pure Firestore transaction functions; no provider or model call occurs inside a Firestore transaction callback.
- A crash before intent commit leaves no authorized attempt.
- A crash after intent commit but before dispatch leaves `prepared` and is safely recoverable.
- A crash after dispatch but before response leaves `dispatched` and is reconciled as unknown.
- A crash after observed response but before receipt commit leaves sufficient attempt identity for reconciliation.
- A crash after receipt commit but before verification schedules independent verification.
- A stale epoch receives `409 stale operation epoch`; the write is not applied.
- Duplicate event delivery returns the existing inbox outcome without repeating domain acceptance.
- Artifact-storage failure fails the projection or preserves bounded inline evidence; it never reports a nonexistent artifact reference.
- Context compilation failure is a protocol failure and does not silently fall back to an unbounded conversation.

## Migration and compatibility

The schema is additive. Existing jobs, stage events, receipts, verifications, and effect commands remain readable. New operations are created lazily for new stage/event/effect work. Existing effect states are mapped as follows when read:

- `pending` → authorized intent;
- `claimed` → prepared;
- `applied` → receipted/applied;
- `failed` → definite failed result;
- `uncertain` → unknown.

No existing historical record is rewritten merely to populate the new ledger. A separate read-only migration report may identify records without operation lineage.

## Test strategy

All production behavior is implemented test-first.

### TypeScript unit tests

- operation transitions, epoch increments, replay-policy decisions, and stale fences;
- canonical event identity and duplicate acceptance;
- outbox stable event identity and ambiguous republish;
- effect prepared/dispatched/unknown/observed transitions;
- artifact metadata, digest, preview, range validation, and tenant isolation;
- context manifest stability, pinning, revision selection, and budgets;
- recovery classification and bounded keyset paging;
- approval-bound ambiguity decisions.

### Firestore emulator integration tests

- concurrent event acceptance produces one inbox record and one operation;
- concurrent operation claims produce one current epoch;
- stale worker writes fail after reclaim;
- state transition and outbox creation are atomic;
- receipt finalization updates command, claim, operation, job, and receipt atomically;
- recovery pages scale with pending records;
- cross-tenant artifact and operation access fails.

### Python tests

- every protected web mutation carries operation ID and epoch;
- the context compiler pins constraints/current revisions and spills oversized evidence;
- external content cannot enter the authority section;
- effect executor records dispatch before provider entry and maps post-dispatch exceptions to unknown;
- heartbeat recovery executes independent arms and never auto-replays unknown effects;
- Pub/Sub push duplicates stop before stage/model/provider execution.

### Fault-injection scenarios

A deterministic harness injects failure immediately before and after inbox acceptance, claim, projection persistence, model completion, intent preparation, provider dispatch, provider response, receipt commit, and verification. It also tests delayed duplicates, reordered revisions, lease expiry with a paused worker, poisoned external evidence, missing artifacts, and schema/compiler-version changes.

The harness reports duplicate domain transitions, duplicate external effects, correctly surfaced unknowns, stale-write rejections, constraint survival, current-revision accuracy, projection evidence coverage, artifact digest matches, recovery work units, token volume, and final audit completeness.

## Verification and execution gates

The implementation is not complete until all of these pass from the isolated worktree:

1. `npm test`
2. `npm run test:agent`
3. Firestore and Pub/Sub emulator integration suites with no skipped runtime tests
4. `npm run lint`
5. `npm run build`
6. deterministic fault-injection benchmark
7. local worker/web execution and health checks
8. one real authenticated vertical slice using configured Gemini, Firestore, Pub/Sub, GCS, and an approved export or official publish effect
9. independent verification receipt and replay/idempotency evidence

If credentials or cloud resources are unavailable, the code and local/emulator gates continue to completion, while the authenticated run remains explicitly unverified. No mock, fixture, or replay is presented as real provider evidence.

## Completion invariants

1. Authoritative progress is reconstructable without asking an LLM to infer it from conversation prose.
2. Duplicate source events are accepted at most once.
3. Stale worker epochs cannot commit protected state.
4. External effects never become successful without a receipt and required verification.
5. Post-dispatch uncertainty is explicit and not blindly replayed.
6. Approval remains bound to the exact effect digest.
7. Policy enforcement survives context compaction because it is outside conversation memory.
8. Large omitted evidence remains durably addressable while retention permits.
9. Every model decision has a reproducible projection manifest.
10. Superseded revisions are not treated as equally current memory.
11. Event, operation, artifact, approval, effect, receipt, and verification lineage is tenant-isolated.
12. Recovery and autonomy are bounded by durable time, cost, retry, and work limits.
