# Conversation Routing and Contract Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add canonical dashboard conversation URLs and eliminate the obsolete strategy evidence bound that rejected the live 53-ID payload.

**Architecture:** Keep conversation identity in the existing persisted `conversationId`, project it into the Next.js route, and make route changes the single selection mechanism for New and Past Chats. Keep Python as the producer of complete typed evidence, align the TypeScript ingestion schema to those documented bounds, and expose only safe validation metadata to the worker and persisted failure envelope.

**Tech Stack:** Next.js App Router, React, TypeScript, Zod, Vitest, Python 3.12, Pydantic, pytest, Cloud Run, Firestore.

**Spec:** `docs/superpowers/specs/2026-09-04-conversation-routing-contract-recovery.md`

## Global Constraints

- Do not truncate source evidence to satisfy downstream contracts.
- Preserve existing user changes in the dirty worktree.
- Retry only transient provider/dependency failures; deterministic validation failures are not automatically replayed.
- Do not expose prompt, transcript, response body, credentials, or tokens in public failures.
- Deploy only after focused tests, full suites, production build, and diff checks pass.

---

### Task 1: Canonical conversation routes

**Files:**
- Create: `src/app/dashboard/[conversationId]/page.tsx`
- Modify: `src/app/dashboard/page.tsx`
- Modify: `src/components/ChatConsole.tsx`
- Modify: `src/components/DashboardFrame.tsx`
- Test: `tests/dashboardNavigation.test.ts`
- Test: focused ChatConsole test file selected from the existing test conventions

**Interfaces:**
- Consumes: persisted `ConsoleMessage.conversationId` and `groupSessions(messages)`.
- Produces: `ChatConsole({ conversationId?: string })`, canonical `/dashboard/{conversationId}` navigation, and studio-shell detection for dashboard descendants.

- [ ] **Step 1: Write failing routing tests**

Cover studio layout for `/dashboard/conversation-1`, a dynamic page that passes the route parameter to `ChatConsole`, and selection helpers that produce encoded canonical paths.

- [ ] **Step 2: Run focused tests and confirm failure**

Run: `pnpm vitest run tests/dashboardNavigation.test.ts <focused-chat-test>`

- [ ] **Step 3: Implement minimal routing behavior**

Add the dynamic route, use `router.push`/`router.replace` from New and Past Chats, and derive visible messages from the route parameter.

- [ ] **Step 4: Run focused tests and confirm success**

Run the same focused Vitest command and require zero failures.

### Task 2: Cross-runtime strategy contract parity

**Files:**
- Modify: `src/lib/contracts.ts`
- Modify: `src/lib/internalHandler.ts`
- Modify: `agent/harmonia_agent/web_client.py`
- Modify: `agent/harmonia_agent/failures.py`
- Test: `tests/contracts.test.ts`
- Test: `tests/internalFence.test.ts`
- Test: `agent/tests/test_failures.py`
- Test: relevant web-client tests under `agent/tests/`

**Interfaces:**
- Consumes: strategy invocation payloads containing complete moment, angle, and transcript-segment identifiers.
- Produces: an aligned schema and a safe `AgentContractError`/failure detail path for deterministic HTTP 400 validation failures.

- [ ] **Step 1: Write failing contract and diagnostic tests**

Build a 53-ID fixture matching the live failure, assert it validates, and assert malformed payload responses identify `sourceIds` without returning content.

- [ ] **Step 2: Run focused TypeScript and Python tests and confirm failure**

Run: `pnpm vitest run tests/contracts.test.ts tests/internalFence.test.ts` and `cd agent && ./.venv/bin/python -m pytest tests/test_failures.py <web-client-test> -q`.

- [ ] **Step 3: Align bounds and typed error propagation**

Replace the obsolete 24-ID bound with the documented complete-evidence capacity and carry endpoint/field/count metadata through the safe failure envelope. Keep validation failures permanent until code/input changes.

- [ ] **Step 4: Run focused tests and confirm success**

Run the same focused commands and require zero failures.

### Task 3: Verification, deployment, and recovery

**Files:**
- Modify only deployment/evidence files required by the repository's existing release procedure.

**Interfaces:**
- Consumes: passing routing and contract changes.
- Produces: deployed web/worker revisions and a recovered live job progressing beyond `strategize` or an exact new actionable failure.

- [ ] **Step 1: Run complete verification**

Run full Vitest, pytest, TypeScript/build, and `git diff --check` using the existing project scripts.

- [ ] **Step 2: Deploy changed services**

Use the existing deployment scripts and preserve the configured Vertex/global Gemini 3.7 Flash and current Agent Engine resource.

- [ ] **Step 3: Retry the exact live job through the supported API/UI recovery path**

Retry `bc179238-95b6-4b35-8561-67035278cb01` without direct database mutation and observe persisted stage progress.

- [ ] **Step 4: Verify production behavior**

Open the canonical conversation URL, refresh it, verify the correct conversation remains selected, and confirm the job reaches strategy approval or produces safe field-level diagnostics.
