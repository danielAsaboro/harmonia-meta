# Temi Editorial Planner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Temi persist a validated four-week editorial plan and hand exactly one deterministic next item to Noni.

**Architecture:** A focused Temi ADK invocation produces a strict plan proposal from an approved Ryan strategy. Deterministic Python and TypeScript validators bind it to the strategy and evidence, Firestore atomically persists the full plan and selected item, and the production workflow gives only that item to Noni and Dara.

**Tech Stack:** Google ADK, Pydantic, Python pytest, TypeScript, Zod, Firestore transactions, Vitest, Next.js.

**Spec:** `docs/superpowers/specs/2026-08-27-temi-editorial-planner-design.md`

## Global Constraints

- Firestore remains durable workflow truth.
- Temi has no approval, external calendar, publishing, credential, receipt, or effect tools.
- The approved Ryan strategy digest is immutable input authority, not Memory Bank.
- The plan covers the supplied four-week horizon and selects exactly one eligible item.
- Noni drafts only the selected item.
- No compatibility aliases, legacy schemas, dual reads, or migration adapters.
- No paid calls, deployments, publishing, external scheduling, or authenticated capture.

---

### Task 1: Strict Temi and production contracts

**Files:**
- Modify: `agent/harmonia_agent/agent_models.py`
- Create: `agent/tests/test_temi_editorial_plan.py`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/contracts.ts`
- Create: `tests/temiEditorialPlanContract.test.ts`

**Interfaces:**
- Produces: `EditorialPlannerInput`, expanded `EditorialPlan`, `EditorialPlanItem`, and `ProductionDraftInput` with matching Python/Zod/TypeScript shapes.

- [ ] Write failing Python tests for complete plans, required fields, exactly one selected item, strict extra-field rejection, horizon/timezone, and forbidden final-copy/effect fields.
- [ ] Run `../../../agent/.venv/bin/python -m pytest -q tests/test_temi_editorial_plan.py` and confirm red failures.
- [ ] Implement the minimal strict Pydantic contracts and remove the thin calendar-item schema.
- [ ] Write matching Zod/TypeScript contract tests, including boundary parity fixtures.
- [ ] Run `../../node_modules/.bin/vitest run tests/temiEditorialPlanContract.test.ts` and confirm red, then implement the matching web contracts.
- [ ] Run both focused suites and commit `feat: define strict Temi editorial contracts`.

### Task 2: Temi prompt and deterministic validation

**Files:**
- Create: `agent/harmonia_agent/temi_prompt.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/tests/test_temi_editorial_plan.py`
- Modify: `agent/tests/test_agent_team.py`

**Interfaces:**
- Consumes: `EditorialPlannerInput` and `EditorialPlan` from Task 1.
- Produces: `validate_editorial_plan(input, plan) -> EditorialPlan` and a tool-free `temi_editorial_planner` ADK agent.

- [ ] Add failing tests for unknown briefs/evidence, unsupported channels/formats, invalid windows/deadlines, duplicate slots, unknown/cyclic dependencies, capacity overflow, ineligible selection, strategy mismatch, and authority overreach.
- [ ] Run the focused tests and verify each new case fails for the intended reason.
- [ ] Implement Temi's focused method prompt and validator with exact supplied-ID sets.
- [ ] Split Temi planning from the current combined Flo invocation while preserving the bounded Noni/Dara loop.
- [ ] Run focused agent/team tests and commit `feat: validate Temi plans against approved strategy`.

### Task 3: Distinct plan persistence boundary

**Files:**
- Modify: `agent/harmonia_agent/stages.py`
- Create: `agent/tests/test_temi_stages.py`
- Create: `src/lib/editorialPlan.ts`
- Modify: `src/lib/firestore.ts`
- Create: `src/app/api/internal/editorial-plan/route.ts`
- Modify: `src/lib/stages.ts`
- Modify: `src/lib/types.ts`
- Create: `tests/editorialPlan.test.ts`
- Modify: `tests/stages.test.ts`

**Interfaces:**
- Produces: canonical `editorialPlanDigest(plan)`, transactional `acceptEditorialPlan`, durable `plan` stage, and selected-item lifecycle transition.

- [ ] Add failing pure tests for canonical digesting, strategy binding, immutable plan history, selected-item eligibility, and stale/mismatched submissions.
- [ ] Add failing stage tests proving Temi persists before Noni and planning failure prevents drafting.
- [ ] Implement `strategy approval → plan → draft` stage wiring and a dedicated internal plan route.
- [ ] Atomically persist the complete plan, digest, revision, evidence lineage, and selected item before dispatching draft.
- [ ] Run focused Python/TypeScript tests and commit `feat: persist Temi plans before production`.

### Task 4: Exact selected-item Noni handoff

**Files:**
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `agent/harmonia_agent/agent_models.py`
- Modify: `agent/tests/test_agent_team.py`
- Modify: `agent/tests/test_temi_stages.py`
- Modify: `src/app/api/internal/drafts/route.ts`
- Modify: `src/lib/firestore.ts`

**Interfaces:**
- Consumes: persisted approved `EditorialPlan` and `selectedNextItemId`.
- Produces: `ProductionDraftInput` passed to the Noni/Dara loop and content items linked to `editorialPlanId`/`editorialItemId`/`briefId`.

- [ ] Write failing tests proving only the selected item reaches Noni, its exact brief/evidence are preserved, and other plan items remain `planned`.
- [ ] Run focused tests and confirm red failures.
- [ ] Implement the narrow production input and deterministic selected → drafting transition.
- [ ] Persist reviewed/action lifecycle transitions against the same editorial item; stop reconstructing calendar provenance from final text.
- [ ] Run focused tests and commit `feat: hand one Temi item to Noni`.

### Task 5: Firestore/API/UI representation

**Files:**
- Modify: `src/components/jobTypes.ts`
- Modify: `src/components/studio/SourcesWorkspace.tsx`
- Modify: `src/components/PipelineStepper.tsx`
- Modify: `src/components/MonitoringView.tsx`
- Modify: `src/components/monitoring/LogsView.tsx`
- Modify: `src/lib/a2ui/hydrateSurfacePlan.ts`
- Add or modify focused component/API tests under `tests/`.

**Interfaces:**
- Consumes: persisted plan and item lifecycle state.
- Produces: job detail rendering for plan horizon, cadence, lineage, item windows/deadlines/dependencies, and selected-item rationale.

- [ ] Add failing API/persistence tests for complete plan round-trip and tenant/strategy binding.
- [ ] Add failing rendering tests for the selected item, remaining planned items, provenance, assumptions, and confidence.
- [ ] Implement API serialization and the Temi plan workspace section from persisted job truth.
- [ ] Update monitoring stage lists and progress labels for `plan`.
- [ ] Run focused tests and commit `feat: expose Temi editorial plan state`.

### Task 6: Evaluations and current documentation

**Files:**
- Modify: `agent/harmonia_agent/evaluation_contracts.py`
- Modify: `agent/tests/test_evaluation_contracts.py`
- Add Temi evaluation fixtures under the existing evaluation fixture location.
- Modify: `README.md`
- Modify: `docs/pipeline.mdx`
- Modify: `docs/architecture.mdx`
- Modify: `docs/agent-platform.mdx`
- Modify: `docs/state-ownership.mdx`
- Modify: `docs/interfaces.mdx`
- Modify: `src/lib/architecture/data.ts`
- Modify: `tests/architectureData.test.ts`

**Interfaces:**
- Produces: evaluation verdicts for coherent plan, missing evidence, invented references, authority overreach, incomplete items, invalid dates/dependencies, and exact selected-item behavior.

- [ ] Add failing evaluation tests for every required Temi case.
- [ ] Implement evaluation classification without exact-prompt assertions.
- [ ] Update current docs and architecture labels; leave historical design records unchanged.
- [ ] Run evaluation and architecture tests and commit `docs: document Temi editorial planning`.

### Task 7: Full verification and branch completion

**Files:**
- Review all changed files; do not add unrelated changes.

**Interfaces:**
- Produces: a verified isolated Temi feature commit ready for the user's integration choice.

- [ ] Run the complete Python agent suite.
- [ ] Run the complete Vitest suite.
- [ ] Run ESLint and `tsc --noEmit`.
- [ ] Install or link worktree-local dependencies if required, then run the production Next.js build.
- [ ] Run `git diff --check`, inspect the complete diff and repository status, and request an independent code review.
- [ ] Fix all Critical and Important review findings and rerun affected plus full verification.
- [ ] Commit the final verified implementation and preserve the worktree.
- [ ] Offer exactly: merge locally, push/create PR, or keep branch.
