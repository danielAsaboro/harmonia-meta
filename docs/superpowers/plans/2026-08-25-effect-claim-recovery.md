# Effect Claim and Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent concurrent or recovered workers from duplicating external effects and produce a real operator-triggered replay proof.

**Architecture:** A Firestore transaction claims the stable idempotency key before execution. Receipt finalization atomically closes the claim, action, and receipt; unresolved expired claims fail closed for operator reconciliation. A tenant-authenticated replay-proof route calls the same claim boundary but is prohibited from executing.

**Tech Stack:** TypeScript, Next.js route handlers, Firestore transactions, Python stage worker, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-08-25-effect-claim-recovery-design.md`

## Global Constraints

- No claim path may approve an action or execute an effect.
- No expired, unfinalized claim may automatically retry an external effect.
- Every response carries the stable idempotency key, operation ID, trace ID, and durable evidence identity where applicable.
- The private collector remains read-only.

---

### Task 1: Atomic claim state machine

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/firestore.ts`
- Test: `tests/effectClaims.test.ts`

**Interfaces:**
- Produces: `claimEffect(input): Promise<EffectClaimOutcome>` and durable `EffectClaim` records.

- [ ] Write tests proving one owner, live contention, expired uncertainty, applied replay, tenant/action validation, and no approval mutation.
- [ ] Run `npm test -- --run tests/effectClaims.test.ts` and confirm the missing interface fails.
- [ ] Implement the minimal transactional state machine keyed by the SHA-256 idempotency key.
- [ ] Re-run the focused tests and commit the green state.

### Task 2: Claim and atomic receipt APIs

**Files:**
- Create: `src/app/api/internal/effect-claim/route.ts`
- Modify: `src/app/api/internal/receipt/route.ts`
- Modify: `src/lib/contracts.ts`
- Modify: `src/lib/firestore.ts`
- Test: `tests/effectClaimContracts.test.ts`

**Interfaces:**
- Consumes: `claimEffect`.
- Produces: strict internal claim payload/response and `finalizeEffectReceipt`.

- [ ] Write failing contract and transaction tests for claim metadata, claim ownership, receipt linkage, and duplicate finalization.
- [ ] Run the focused tests and confirm expected failures.
- [ ] Implement the internal route and transactional receipt finalization.
- [ ] Re-run focused tests and commit.

### Task 3: Claim-before-effect worker integration

**Files:**
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `agent/harmonia_agent/web_client.py`
- Modify: `agent/harmonia_agent/failures.py`
- Test: `agent/tests/test_agent_stages.py`
- Test: `agent/tests/test_failures.py`

**Interfaces:**
- Consumes: internal claim response.
- Produces: no effect call unless outcome is `execute`; typed retryable `in_progress` and permanent `uncertain` failures.

- [ ] Write failing tests for all four outcomes and assert provider adapters are untouched for three non-execute outcomes.
- [ ] Run the focused pytest selection and confirm failures.
- [ ] Add claim-before-effect handling and typed failure mapping.
- [ ] Re-run focused tests and commit.

### Task 4: Operator replay proof

**Files:**
- Create: `src/app/api/jobs/[id]/actions/[actionId]/replay/route.ts`
- Modify: `src/components/JobDetail.tsx`
- Modify: `src/components/studio/ApprovalDock.tsx`
- Test: `tests/replayAuthority.test.ts`
- Test: `tests/approvalAccessibility.test.ts`

**Interfaces:**
- Consumes: the same `claimEffect` state machine.
- Produces: operator-only `already_applied` proof and durable `ReplayObservation`; never `execute`.

- [ ] Write failing authority tests covering unauthenticated/non-operator access, non-finalized claims, and successful replay observation.
- [ ] Run focused tests and confirm failures.
- [ ] Implement the route and accessible UI control for executed actions.
- [ ] Re-run focused tests and commit.

### Task 5: Evidence and regression

**Files:**
- Modify: `docs/evidence-runbook.mdx`
- Modify: `docs/approval-and-audit.mdx`
- Modify private: `submission/evidence-runner/collect_vertical_slice.py`
- Modify private: `submission/evidence-runner/test_collect_vertical_slice.py`

**Interfaces:**
- Consumes: finalized claim and replay observation metadata.
- Produces: read-only evidence capture that proves claim-before-effect and replay suppression.

- [ ] Add failing verifier/collector tests requiring a finalized effect claim linked to the effect receipt.
- [ ] Implement redacted claim export and bundle checks without adding collector mutations.
- [ ] Run all TypeScript tests, all Python tests, collector tests, typecheck, lint, and production build.
- [ ] Commit and integrate only after every gate passes.
