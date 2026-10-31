# Harmonia A2UI Chat Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a streaming, upload-capable, approval-safe A2UI Chat Console without adding Vercel AI SDK or Genkit.

**Architecture:** A typed NDJSON chat stream carries host events and A2UI operations. The official A2UI React renderer consumes only validated A2UI payloads, while trusted React components retain control of uploads, reconnection, and confirmations.

**Tech Stack:** Next.js 16, React 19, TypeScript, Zod, Google ADK, A2UI v0.9.1, Firestore, Cloud Storage, Vitest, Pytest.

**Spec:** `docs/superpowers/specs/2026-08-23-a2ui-chat-console-design.md`

## Global Constraints

- Do not install or import Vercel AI SDK, AI Elements, or Genkit.
- Never expose raw hidden model reasoning.
- Agent-produced data cannot directly approve or execute an operation.
- Existing public chat, job, action, approval, receipt, and Pub/Sub contracts remain compatible.
- Production uploads must go directly to tenant-scoped Cloud Storage through resumable sessions.
- Mock mode must use the same validation and rendering contracts as real mode.

---

### Task 1: Protocol and catalog contracts

**Files:**
- Create: `src/lib/a2ui/contracts.ts`
- Create: `src/lib/a2ui/catalog.ts`
- Create: `tests/a2uiContracts.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `ChatStreamEvent`, `parseChatStreamEvent`, `HARMONIA_CATALOG_ID`, safe URL parsing, and catalog component schemas.

- [ ] Write tests that reject unknown events, raw reasoning fields, unsafe citation URLs, unknown component types, and malformed confirmation references.
- [ ] Run `npm test -- tests/a2uiContracts.test.ts` and verify the tests fail because the contracts do not exist.
- [ ] Implement the minimal Zod event and component contracts.
- [ ] Install the official A2UI React and web-core packages using pinned compatible versions.
- [ ] Run the focused test and verify it passes.
- [ ] Commit the protocol slice.

### Task 2: Trusted component system

**Files:**
- Create: `src/components/a2ui/ActivityTrace.tsx`
- Create: `src/components/a2ui/AttachmentCard.tsx`
- Create: `src/components/a2ui/ConfirmationCard.tsx`
- Create: `src/components/a2ui/ContextUsage.tsx`
- Create: `src/components/a2ui/InlineCitation.tsx`
- Create: `src/components/a2ui/MessageContent.tsx`
- Create: `src/components/a2ui/PlanView.tsx`
- Create: `src/components/a2ui/QueueView.tsx`
- Create: `src/components/a2ui/ReasoningSummary.tsx`
- Create: `src/components/a2ui/TaskView.tsx`
- Create: `src/components/a2ui/ToolActivity.tsx`
- Create: `src/components/a2ui/A2uiSurfaceHost.tsx`
- Create: `tests/a2uiViewModel.test.ts`

**Interfaces:**
- Consumes: catalog component data from Task 1.
- Produces: safe view-model normalizers and trusted React renderers registered with the Harmonia catalog.

- [ ] Write failing behavior tests for safe reasoning summaries, citation normalization, status transitions, and confirmation authority.
- [ ] Run the focused tests and observe the expected missing-module failures.
- [ ] Implement view-model normalization and focused components.
- [ ] Register the components with the official A2UI renderer using a client-only host.
- [ ] Run focused tests, TypeScript, and ESLint.
- [ ] Commit the component slice.

### Task 3: Resumable attachments

**Files:**
- Create: `src/lib/chatAttachments.ts`
- Create: `src/app/api/chat/attachments/session/route.ts`
- Create: `src/app/api/chat/attachments/[id]/complete/route.ts`
- Create: `src/app/api/chat/attachments/[id]/route.ts`
- Create: `src/components/a2ui/AttachmentComposer.tsx`
- Create: `tests/chatAttachments.test.ts`
- Modify: `src/lib/firestore.ts`
- Modify: `src/lib/storage.ts`
- Modify: `.env.example`
- Modify: `docs/configuration.mdx`

**Interfaces:**
- Produces: tenant-scoped `ChatAttachment`, resumable session creation, completion verification, authorized preview, and composer upload state.

- [ ] Write failing tests for MIME and size rejection, tenant-scoped object names, readiness checks, and attachment reference validation.
- [ ] Run the focused tests and verify expected failures.
- [ ] Implement Firestore records and Cloud Storage resumable-session creation.
- [ ] Implement completion verification and authorized download.
- [ ] Implement local-development upload fallback and composer progress/cancel/retry.
- [ ] Run focused tests, TypeScript, and ESLint.
- [ ] Commit the attachment slice.

### Task 4: Durable stream and confirmations

**Files:**
- Create: `src/lib/chatRuns.ts`
- Create: `src/lib/pendingOperations.ts`
- Create: `src/app/api/chat/stream/route.ts`
- Create: `src/app/api/chat/runs/[id]/events/route.ts`
- Create: `src/app/api/chat/operations/[id]/decision/route.ts`
- Create: `tests/chatRuns.test.ts`
- Create: `tests/pendingOperations.test.ts`
- Modify: `src/app/api/chat/route.ts`
- Modify: `src/lib/firestore.ts`

**Interfaces:**
- Consumes: `ChatStreamEvent`, ready attachment IDs, and existing `ChatResponse` behavior.
- Produces: monotonically sequenced persisted events, replay, NDJSON streaming, and single-use operation decisions.

- [ ] Write failing tests for sequence ordering, replay offsets, terminal failures, tenant isolation, expiry, and decision replay.
- [ ] Run focused tests and verify the failures are caused by missing behavior.
- [ ] Implement durable run and event persistence.
- [ ] Implement the streaming route while preserving the existing JSON route.
- [ ] Implement generic confirmation decisions and map existing action confirmations to current endpoints.
- [ ] Run focused tests, TypeScript, and ESLint.
- [ ] Commit the backend slice.

### Task 5: Console and Drawer integration

**Files:**
- Create: `src/hooks/useHarmoniaChat.ts`
- Modify: `src/components/ChatConsole.tsx`
- Modify: `src/components/ChatDrawer.tsx`
- Modify: `src/lib/chatSessions.ts`
- Create: `tests/chatStreamReducer.test.ts`

**Interfaces:**
- Consumes: NDJSON stream events, trusted renderers, attachment composer, and decision endpoints.
- Produces: reconnecting full Console and reduced shared rendering in the Drawer.

- [ ] Write failing reducer tests for text deltas, activity, A2UI operations, confirmations, completion, failure, and replay de-duplication.
- [ ] Run focused tests and verify expected failures.
- [ ] Implement the streaming reducer and hook with abort and reconnect support.
- [ ] Replace Console message rendering with the shared component system and add the attachment composer.
- [ ] Reuse only message, attachment, and confirmation components in the Drawer.
- [ ] Run focused tests, TypeScript, ESLint, and web tests.
- [ ] Commit the integration slice.

### Task 6: Verification and documentation

**Files:**
- Modify: `docs/architecture.mdx`
- Modify: `docs/interfaces.mdx`
- Modify: `docs/development.mdx`

**Interfaces:**
- Produces: judge-readable architecture and exact local/cloud behavior documentation.

- [ ] Document the A2UI catalog, streaming event boundary, upload transport, and approval boundary.
- [ ] Run `npm run lint`.
- [ ] Run `npx tsc --noEmit`.
- [ ] Run `npm test`.
- [ ] Run `cd agent && ./.venv/bin/python -m pytest tests -q`.
- [ ] Run `git diff --check` and inspect the final diff.
- [ ] Commit the verified implementation.
