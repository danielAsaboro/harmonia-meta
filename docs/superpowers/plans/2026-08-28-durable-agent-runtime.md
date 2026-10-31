# Durable Agent Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Harmonia survive multi-hour or multi-day, event-driven runs without treating an LLM context window as durable state, while preserving exactly-once domain transitions, explicit effect ambiguity, reproducible context projections, and bounded crash recovery.

**Architecture:** Extend the existing Firestore/Pub/Sub/Cloud Run/Google ADK runtime with a canonical operation ledger, stable event inbox, monotonically fenced claims, artifact metadata, deterministic context projections, explicit effect-dispatch states, and a recovery controller. Firestore remains authoritative; Pub/Sub remains an at-least-once wake transport; GCS holds large immutable payloads; model context is a disposable projection of durable state.

**Tech Stack:** Next.js 16, TypeScript, Zod, Firestore transactions, Google Cloud Pub/Sub and Storage, Python 3.12, Google ADK, pytest, Vitest, Firestore/Pub/Sub emulators.

**Design spec:** `docs/superpowers/specs/2026-08-28-durable-agent-runtime-design.md`

**Global constraints:** Preserve current public contracts additively. Keep all records tenant-scoped. Use deterministic IDs and digests. Never authorize an effect from memory text. Never automatically replay an effect after dispatch ambiguity. Do not claim emulator, cloud, Gemini, or provider verification unless that exact path ran successfully.

---

## Task 1: Operation state machine and fencing contract

**Files:**
- Create: `src/lib/operations.ts`
- Test: `tests/operations.test.ts`

- [ ] Write failing tests covering deterministic operation IDs, initial construction, first claim at epoch 1, active-lease rejection, safe-policy reclaim with epoch increment, reconcile/never expiry to `unknown`, stale-epoch rejection, and legal/illegal terminal transitions.
- [ ] Run `npx vitest run tests/operations.test.ts` and confirm failure because the module does not exist.
- [ ] Implement typed `OperationKind`, `OperationState`, `ReplayPolicy`, `OperationRecord`, claim/fence/finalize inputs and pure transition functions. Parse timestamps strictly and make every returned record immutable-by-copy.
- [ ] Re-run the focused test and confirm green.
- [ ] Run `git diff --check`, then commit: `feat: define durable operation state machine`.

## Task 2: Transactional operation repository

**Files:**
- Create: `src/lib/operationStore.ts`
- Modify: `src/lib/firestore.ts`
- Create: `tests/operationStore.test.ts`
- Create: `tests/operationFirestore.integration.test.ts`

- [ ] Write failing repository tests for tenant paths, deterministic creation, claim transactions, fence checks, terminal updates, and paginated recovery candidates.
- [ ] Write emulator tests proving two concurrent claims yield one owner, reclaim increments epoch, a stale worker cannot commit, and cross-tenant access fails.
- [ ] Run both focused tests; confirm the unit suite fails for missing implementation and the integration suite runs when `FIRESTORE_EMULATOR_HOST` is present.
- [ ] Implement repository functions with injected transaction adapters for unit tests and Firestore wrappers for production. Add only thin exports to `firestore.ts` to preserve the existing persistence boundary.
- [ ] Re-run focused unit and emulator tests.
- [ ] Commit: `feat: persist and fence durable operations`.

## Task 3: Stable event envelopes and inbox deduplication

**Files:**
- Create: `src/lib/eventInbox.ts`
- Create: `src/lib/eventInboxStore.ts`
- Modify: `src/lib/stageOutbox.ts`
- Modify: `src/lib/stageOutboxDispatcher.ts`
- Modify: `src/lib/pubsub.ts`
- Modify: `src/lib/firestore.ts`
- Create: `tests/eventInbox.test.ts`
- Create: `tests/eventInboxFirestore.integration.test.ts`
- Modify: `tests/stageOutbox.test.ts`
- Modify: `tests/stageOutboxFirestore.integration.test.ts`
- Modify: `tests/pubsubTenancy.test.ts`

- [ ] Write failing tests for canonical `(source, sourceEventId)` hashing, stable stage-outbox event identity across publish attempts, payload digest verification, inbox outcomes (`execute`, `in_progress`, `already_completed`, `rejected`), and replay-policy handling after an abandoned lease.
- [ ] Add emulator tests showing duplicate Pub/Sub deliveries accept one domain event and that inbox acceptance plus operation creation is atomic.
- [ ] Run the focused tests and record the expected failures.
- [ ] Implement a versioned event envelope and transactional inbox. Extend outbox records additively with `sourceEventId`, `schemaVersion`, `operationId`, correlation/causation fields, and `publishAttempt`; never key deduplication on Pub/Sub message ID.
- [ ] Re-run focused unit/emulator tests and the existing stage-outbox tests.
- [ ] Commit: `feat: deduplicate durable source events`.

## Task 4: Worker event acceptance and fenced request context

**Files:**
- Create: `src/app/api/internal/event-inbox/claim/route.ts`
- Create: `src/app/api/internal/event-inbox/finalize/route.ts`
- Create: `src/app/api/internal/operation/claim/route.ts`
- Create: `src/app/api/internal/operation/finalize/route.ts`
- Modify: `src/lib/internalHandler.ts`
- Create: `agent/harmonia_agent/operation_context.py`
- Modify: `agent/harmonia_agent/web_client.py`
- Modify: `agent/harmonia_agent/main.py`
- Create: `tests/internalFence.test.ts`
- Create: `tests/eventInboxRoutes.test.ts`
- Create: `agent/tests/test_operation_context.py`
- Modify: `agent/tests/test_main.py`

- [ ] Write failing route tests proving protected mutations reject missing, stale, terminal, or cross-tenant fences and accept the current epoch.
- [ ] Write failing Python tests proving operation context is scoped, cannot leak between events, and automatically attaches both operation headers to protected calls.
- [ ] Write failing worker tests proving inbox dedup occurs before stage/model execution and transient errors leave a retryable record.
- [ ] Implement claim/finalize endpoints, `internalRoute({ requireFence: true })`, Python `ContextVar` operation scope, and event acceptance in the Pub/Sub push path.
- [ ] Apply `requireFence` first to stage finalization and the new projection/effect transitions; migrate other protected mutation routes as their task lands.
- [ ] Re-run all focused TypeScript and Python tests.
- [ ] Commit: `feat: enforce event inbox and operation fences`.

## Task 5: Artifact metadata and bounded retrieval

**Files:**
- Create: `src/lib/artifacts.ts`
- Create: `src/lib/artifactStore.ts`
- Create: `src/app/api/internal/artifacts/route.ts`
- Create: `src/app/api/internal/artifacts/[id]/route.ts`
- Modify: `src/lib/storage.ts`
- Create: `tests/artifacts.test.ts`
- Create: `tests/artifactStore.test.ts`
- Create: `agent/tests/test_artifact_client.py`
- Modify: `agent/harmonia_agent/web_client.py`

- [ ] Write failing tests for metadata validation, tenant-scoped unpredictable object paths, SHA-256 verification, bounded byte/line reads, preview limits, trust labels, and rejection of cross-tenant or digest-mismatched reads.
- [ ] Run focused tests and confirm red.
- [ ] Implement artifact records over the existing GCS client, opaque IDs, immutable metadata, range APIs, and Python upload/read helpers. Do not expose ambient filesystem or bucket paths to the agent.
- [ ] Re-run focused suites.
- [ ] Commit: `feat: add durable artifact spill and retrieval`.

## Task 6: Deterministic context projection compiler

**Files:**
- Create: `src/lib/contextProjections.ts`
- Create: `src/lib/contextProjectionStore.ts`
- Create: `src/app/api/internal/context-projections/route.ts`
- Create: `agent/harmonia_agent/context_projection.py`
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `agent/harmonia_agent/agents.py`
- Create: `tests/contextProjections.test.ts`
- Create: `tests/contextProjectionStore.test.ts`
- Create: `agent/tests/test_context_projection.py`

- [ ] Write failing tests for canonical manifest/render digests, reproducibility, compiler-version pinning, current-revision selection, fixed authority ordering, explicit untrusted-evidence boundaries, head/tail preview with artifact references, and hard token/character budgets.
- [ ] Prove via tests that approval IDs, policy version, goal digest, unresolved effects, and current revision references cannot be dropped by compaction and that memory facts cannot grant authority.
- [ ] Run focused suites and confirm red.
- [ ] Implement the projection record/store and Python compiler. Order sections as authority, operation state, unresolved effects, current revisions, trusted evidence, bounded memory, recent events, then artifact previews. Persist the manifest before a model call and spill oversized rendered context through Task 5.
- [ ] Integrate the compiler at bounded stage/ADK invocation points without injecting the full historical chat or raw tool log.
- [ ] Re-run focused and affected agent tests.
- [ ] Commit: `feat: compile reproducible bounded agent context`.

## Task 7: Explicit external-effect dispatch ambiguity

**Files:**
- Modify: `src/lib/effectCommands.ts`
- Modify: `src/lib/effectClaims.ts`
- Modify: `src/lib/effectCommandStore.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/app/api/internal/effect-claim/route.ts`
- Create: `src/app/api/internal/effect-command/[id]/dispatch/route.ts`
- Modify: `src/app/api/internal/receipt/route.ts`
- Modify: `agent/harmonia_agent/effect_executor.py`
- Modify: `agent/harmonia_agent/web_client.py`
- Modify: `tests/effectCommands.test.ts`
- Modify: `tests/effectClaims.test.ts`
- Modify: `tests/effectCommandStore.test.ts`
- Modify: `tests/effectCommandFirestore.integration.test.ts`
- Modify: `agent/tests/test_effect_executor.py`

- [ ] Write failing tests for `prepared -> dispatched -> observed -> applied|failed|unknown`, mandatory fence checks, and atomic receipt/command/operation finalization.
- [ ] Add fault tests where the process fails immediately before provider entry, after provider entry but before response, and after response but before receipt commit. Assert only a typed `ProviderEffectNotStarted` restores safe retry; every ordinary post-dispatch exception becomes `unknown`.
- [ ] Run focused suites and confirm red.
- [ ] Implement additive dispatch metadata and transitions. Persist `dispatched` before invoking any provider, preserve existing immutable approval digest binding, and require reconciliation or operator resolution before retrying unknown effects.
- [ ] Re-run focused unit, Python, and emulator tests.
- [ ] Commit: `feat: preserve external effect ambiguity`.

## Task 8: Recovery planner and bounded controller

**Files:**
- Create: `src/lib/recovery.ts`
- Create: `src/app/api/internal/recovery/route.ts`
- Create: `agent/harmonia_agent/recovery.py`
- Modify: `agent/harmonia_agent/heartbeat.py`
- Modify: `agent/harmonia_agent/durable_tick.py`
- Create: `tests/recovery.test.ts`
- Create: `tests/recoveryFirestore.integration.test.ts`
- Create: `agent/tests/test_recovery.py`
- Modify: `agent/tests/test_heartbeat.py`
- Modify: `agent/tests/test_durable_tick.py`

- [ ] Write failing tests that classify expired safe operations for replay, reconcile operations/effects as unknown, never-policy work as operator-required, abandoned inbox/outbox records for requeue, receipts for verification, and missing/digest-invalid artifacts as blocked.
- [ ] Test strict page, deadline, retry, and cost bounds plus independent-arm failure isolation.
- [ ] Run focused suites and confirm red.
- [ ] Implement a deterministic recovery planner, transactional application of plans, an internal endpoint, and a real `recover_missed` heartbeat arm. Recovery emits new durable work; it never performs an unknown external effect directly.
- [ ] Re-run focused unit, Python, and emulator tests.
- [ ] Commit: `feat: recover bounded durable operations`.

## Task 9: Operator ambiguity resolution and observability

**Files:**
- Create: `src/app/api/jobs/[id]/operations/[operationId]/resolve/route.ts`
- Modify: `src/lib/observability/repository.ts`
- Modify: `src/lib/observability/schema.ts`
- Modify: `src/app/api/internal/observability/route.ts`
- Modify: `src/components/monitoring/WorkflowActivityView.tsx`
- Modify: `src/components/monitoring/ActivityMetrics.tsx`
- Create: `tests/operationResolution.test.ts`
- Modify: `tests/observabilityRepository.test.ts`
- Modify: `tests/agentMonitoringUi.test.ts`

- [ ] Write failing tests for four explicit decisions: confirm applied, confirm not applied and permit retry, compensate, and cancel. Require operator principal, reason, current epoch, and immutable audit evidence.
- [ ] Write failing observability/UI tests for stale leases, unknown effects, inbox lag, outbox lag, projection digest/compiler version, artifact integrity, and recovery outcomes.
- [ ] Run focused suites and confirm red.
- [ ] Implement the resolution route and surface the durable runtime state through existing operator monitoring rather than a parallel dashboard.
- [ ] Re-run focused tests plus accessibility tests touching the view.
- [ ] Commit: `feat: expose durable runtime recovery controls`.

## Task 10: Deterministic crash and context-rot benchmark

**Files:**
- Create: `scripts/verify-durable-runtime.ts`
- Create: `tests/durableRuntimeFaults.test.ts`
- Create: `agent/tests/test_durable_runtime_faults.py`
- Modify: `package.json`
- Create: `docs/durable-runtime.md`
- Modify: `tests/documentationTruth.test.ts`
- Modify: `tests/operationalModelDocs.test.ts`

- [ ] Write failing fault tests for every boundary: before/after inbox acceptance, operation claim, projection persistence, model result, effect preparation, provider dispatch, provider response, receipt commit, and verification.
- [ ] Add delayed duplicate events, reordered revisions, lease expiry with a paused worker, poisoned external evidence, missing artifacts, and compiler-version changes.
- [ ] Implement `npm run verify:durable-runtime` to emit machine-readable counts for duplicate transitions/effects, unknown outcomes, stale-write rejection, constraint survival, current-revision accuracy, artifact digests, recovery units, prompt volume, and audit completeness.
- [ ] Document the architecture, failure semantics, operator actions, local/emulator runbook, cloud behavior, and honest verification limits. Do not publish private research notes.
- [ ] Run the benchmark twice and confirm deterministic output.
- [ ] Commit: `test: verify durable runtime fault recovery`.

## Task 11: Infrastructure and deployment wiring

**Files:**
- Modify: `infra/deploy.sh`
- Modify: `infra/deploy-web-preview.sh`
- Modify: `scripts/dev.sh`
- Modify: `docs/deployment.mdx`
- Modify: `docs/evidence-runbook.mdx`
- Modify: `tests/infraDeployment.test.ts`
- Modify: `tests/infraScripts.test.ts`
- Modify: `tests/healthRoute.test.ts`

- [ ] Write failing infrastructure tests for required indexes, Pub/Sub dead-letter/retry policy, least-privilege access to new collections/artifact paths, recovery scheduling, and health/readiness reporting.
- [ ] Run focused tests and confirm red.
- [ ] Add Firestore indexes/rules where applicable, Pub/Sub envelope settings, recovery scheduler wiring, environment validation, and health detail without exposing tenant data or secrets.
- [ ] Re-run infrastructure, health, and documentation truth tests.
- [ ] Commit: `chore: wire durable runtime infrastructure`.

## Task 12: Full verification and real execution

**Files:**
- Modify only files required by failures found during verification, each through a new failing regression test.
- Store private evidence outside the public repository under the parent `submission/` or evidence directory required by project policy.

- [ ] Run `npm test` and require zero unexpected skips/failures.
- [ ] Run `npm run test:agent` and require zero failures.
- [ ] Start the configured Firestore/Pub/Sub emulators and run integration suites with no runtime-related skips.
- [ ] Run `npm run verify:durable-runtime`.
- [ ] Run `npm run lint`.
- [ ] Run `npm run build`.
- [ ] Start the local web and worker processes, exercise health/readiness, submit a real event, interrupt/restart a worker at a deterministic safe boundary, and prove resumption plus duplicate suppression.
- [ ] If authenticated configuration is available, run one real Gemini + Firestore + Pub/Sub + GCS vertical slice through an operator-approved export or official publish effect, then independently re-read the result and capture sanitized receipts. If any credential/service is absent, report that exact gate as unverified rather than substituting a mock.
- [ ] Inspect `git diff --check`, `git status --short`, and the complete commit log for accidental secrets, private research, generated junk, or unrelated edits.
- [ ] Use the verification-before-completion skill, then commit any final regression-only fixes with precise messages.
