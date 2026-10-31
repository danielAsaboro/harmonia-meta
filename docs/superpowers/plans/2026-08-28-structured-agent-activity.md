# Structured Agent Activity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are prohibited for this side conversation.

**Goal:** Add safe structured errors and an operator-visible activity stream for all Harmonia agent handoffs and Nova tool calls.

**Architecture:** Extend the existing durable job-event stream rather than creating another store. Python produces structured agent/tool diagnostics; TypeScript validates, persists, serves, and renders the same bounded vocabulary.

**Tech Stack:** Python 3.14, Pydantic, Google ADK callbacks, TypeScript, Zod, Firestore, Next.js, React, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-08-28-structured-agent-activity-design.md`

## Global Constraints

- Firestore remains durable workflow truth.
- Events never grant approval or effect authority.
- Do not persist prompts, responses, source text, drafts, credentials, provider bodies, or private reasoning.
- Use a clean contract cut; do not add legacy aliases or dual-read logic.
- Preserve unrelated tracked and untracked files.

---

### Task 1: Strict Python agent and tool errors

**Files:** `agent/harmonia_agent/agent_errors.py`, `tool_contracts.py`, `agent_models.py`, `failures.py`, focused Python tests.

**Produces:** `AgentContractError`, strict `ToolEnvelope`, complete tool error-code validation, and full `LiaisonError` metadata.

- [ ] Write failing tests for stable role/code/path errors, invalid envelope shapes, undeclared error codes, and retained Nova error metadata.
- [ ] Run the focused tests and confirm contract failures.
- [ ] Implement the minimal strict models and normalization.
- [ ] Run the focused tests to green.

### Task 2: Durable structured activity schema

**Files:** `src/lib/contracts.ts`, `src/lib/types.ts`, `src/lib/firestore.ts`, internal failure and artifact persistence routes, tests.

**Produces:** `agentActivityEventSchema`, structured `StageEvent`, and exact event persistence from accepted artifacts and failures.

- [ ] Write failing schema, Firestore, and route tests.
- [ ] Confirm failures are caused by absent structured fields.
- [ ] Implement strict event validation and persistence.
- [ ] Run focused tests to green.

### Task 3: Nova tool trace transport

**Files:** Nova callbacks/runtime, ask API, TypeScript ask client, chat handler/stream contracts, tests.

**Produces:** a sanitized Nova activity trace containing no tool arguments or tool data.

- [ ] Write failing Python and TypeScript transport/privacy tests.
- [ ] Confirm current string-only response fails them.
- [ ] Implement detailed ask result and typed chat forwarding.
- [ ] Run focused tests to green.

### Task 4: Agent monitoring interface

**Files:** `src/app/api/events/route.ts`, `src/app/dashboard/monitoring/page.tsx`, new `src/components/monitoring/AgentActivityView.tsx`, tests.

**Produces:** tenant-scoped filters, chronological handoffs, selectable event details, and explicit retry/failure states.

- [ ] Write failing API and component tests for success, retry, failure, empty, and load-error states.
- [ ] Confirm the Agents monitoring view is absent.
- [ ] Implement the smallest accessible UI matching the approved concept.
- [ ] Run focused tests to green.

### Task 5: Documentation and full verification

**Files:** agent reference pages, `agent-platform.mdx`, `tool-contracts.mdx`, `observability.mdx`.

- [ ] Document exact event, error, tool, privacy, retry, and authority contracts.
- [ ] Run complete pytest and Vitest suites.
- [ ] Run ESLint, `tsc --noEmit`, production build, `git diff --check`, and critical diff review.
