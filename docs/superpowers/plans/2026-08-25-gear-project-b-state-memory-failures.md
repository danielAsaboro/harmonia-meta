# GEAR Project B: State, Memory, History, and Failure Hardening

> **Execution:** implement task-by-task with red-green-refactor checkpoints in an isolated worktree.

**Goal:** Make Harmonia's state ownership, conversation retention, durable memory provenance, and failure/retry behavior explicit, tenant-safe, and mechanically enforced.

**Architecture:** Firestore remains the sole operational source of truth. Chat history gains authenticated-user, interface, and conversation boundaries plus bounded retention and explicit summaries. Memory Bank candidates must cite durable evidence identifiers. Python worker exceptions normalize into a single typed failure envelope consumed by the web API, with centralized bounded retry decisions and safe public messages.

**Non-goals:** ADK session state does not become workflow truth; chat summaries never grant approval; Memory Bank failure never rewrites a verified effect; MCP remains deferred; no automatic retry endpoint is added for permanent failures.

## Task 1 — Typed failure envelope and centralized retry policy

**Files:**
- Create `agent/harmonia_agent/failures.py`
- Create `agent/tests/test_failures.py`
- Modify `agent/harmonia_agent/stages.py`
- Modify `src/lib/contracts.ts`, `src/lib/types.ts`, `src/lib/firestore.ts`, and failure route tests

Write failing tests for all categories: `validation`, `authorization`, `policy`, `budget`, `provider_transient`, `provider_permanent`, `dependency`, and `protocol`. Require `code`, safe `public_message`, `retryable`, `stage`, `operation_id`, `trace_id`, sanitized metadata, and bounded `max_attempts`. Secrets and provider response bodies must not enter the envelope. Unknown exceptions become a retryable dependency failure only up to the central attempt limit.

Replace `classify_failure`'s boolean-only behavior with `normalize_failure`; preserve a compatibility boolean if existing callers need it. Submit the full typed envelope to `/api/internal/failure`, persist it on the job, and make Pub/Sub acknowledgement/redelivery use the normalized retry decision.

## Task 2 — Scoped and bounded conversation history

**Files:**
- Modify `src/lib/firestore.ts`, chat routes/callers, and `src/lib/types.ts`
- Create focused history tests

Every new message records `userId`, `surface`, and `conversationId`. Queries require the same authenticated user and may filter one surface/conversation. Enforce a maximum retained message count per conversation. When pruning, store an explicit metadata-only summary boundary (turn/time range and linked job/run IDs); never ask a model to reconstruct approval or operational state. Legacy messages without scope are excluded from scoped reads rather than silently inherited.

## Task 3 — Evidence-linked Memory Bank records

**Files:**
- Modify `agent/harmonia_agent/memory_bank.py`, its callers, and tests

Require each `MemoryCandidate` to include a durable `evidence_ref` containing job ID and one decision, receipt, verification, or learning record ID. Preserve kind and evidence reference in the direct-memory payload. Reject raw transcripts/drafts, unsupported evidence kinds, missing identifiers, and scope mismatches. Retrieval returns typed facts with evidence references; prompt formatting cites those references while remaining bounded.

Memory retrieval/generation failures are reported through the typed failure contract. A learn-stage memory write occurs only after durable outcome state exists and cannot change an already applied effect.

## Task 4 — State-write conformance and ownership documentation

**Files:**
- Add tests auditing ADK session interaction
- Create `docs/state-ownership.mdx`
- Modify architecture/configuration docs as needed

Prove that agent outputs enter managed state only through `output_key` or event `state_delta`; no code mutates a retrieved ADK session object. Publish a state ownership table covering invocation state, managed session state, Firestore jobs/actions/decisions/receipts/verifications/usage, chat history, Memory Bank, secrets, and private evidence. State scope, lifetime, writers, readers, retention, and source-of-truth status.

## Task 5 — Verification and integration

Run focused tests after each red-green cycle, then:

```bash
npm test
npm run test:agent
npx eslint src tests scripts
npm run build
git diff --check
```

Expected: no failures; existing warnings reported honestly. Commit coherent checkpoints and fast-forward the reviewed work into `main` while preserving user-owned `.superpowers/`.
