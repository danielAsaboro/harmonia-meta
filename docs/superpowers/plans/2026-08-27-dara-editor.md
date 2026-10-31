# Dara Editor Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Dara return complete, grounded editorial judgment while deterministic code owns review metadata, lineage, persistence, and loop control.

**Architecture:** Add a strict agentic `EditorialAssessment` and seven-dimension rubric, validate it against the exact `EditorialReviewInput`, then deterministically construct the persisted `EditorialReview`. Keep the existing one-revision maximum and canonical Firestore production trace.

**Tech Stack:** Python 3.14, Pydantic v2, Google ADK, TypeScript, Zod, Firestore, Next.js, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-08-27-dara-editor-design.md`

## Global Constraints

- Inline execution only; no subagents.
- Dara has no tools and no approval, scheduling, publishing, verification, credential, or workflow-mutation authority.
- Firestore owns durable truth; agent/session output never advances a stage by itself.
- Use strict schemas, fail closed, and make a clean cut with no aliases or dual reads.
- Do not make paid calls, deploy, publish, or fabricate authenticated evidence.
- Preserve unrelated tracked and untracked files.

---

### Task 1: Define the assessment contract

**Files:**
- Modify: `agent/harmonia_agent/agent_models.py`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/contracts.ts`
- Test: `agent/tests/test_dara_contracts.py`
- Test: `tests/daraContracts.test.ts`

**Interfaces:**
- Produces: `EditorialDimension`, `EditorialCheck`, `EditorialAssessment`, closed `EditorialIssuePath`, and rubric-bearing `EditorialReview`.
- Consumes: existing `EditorialReviewInput`, `ContentDraft`, and `CopywriterInput`.

- [ ] Write Python and TypeScript tests that require all seven unique dimensions, strict issue paths, verdict/check consistency, strict JSON containers and scalar types, and absence of model-authored review identity/timestamp fields.
- [ ] Run the focused tests and verify failures are caused by the missing assessment contract.
- [ ] Implement exact Pydantic/Zod/type parity and remove the old model-authored review schema from the ADK boundary.
- [ ] Run focused tests green and commit.

### Task 2: Validate Dara's editorial judgment

**Files:**
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/dara_prompt.py`
- Test: `agent/tests/test_dara_validation.py`

**Interfaces:**
- Produces: `validate_editorial_assessment(input, draft, assessment) -> EditorialAssessment` and `materialize_editorial_review(input, draft, assessment, reviewed_at) -> EditorialReview`.
- Consumes: Task 1 assessment types and exact supplied evidence/constraints.

- [ ] Write failing tests for missing/duplicate dimensions, false acceptance, unmatched failed checks/issues, unknown references, invalid category/path pairs, replacement copy, authority/effect language, incomplete grounding/constraint citations, and ASCII-boundary bypasses.
- [ ] Run each focused group and confirm the intended red failures.
- [ ] Implement the smallest closed-world validator, deterministic stable review ID, exact lineage copy, and UTC timestamp materialization.
- [ ] Rewrite Dara's prompt to output only `EditorialAssessment`, cover all dimensions, cite supplied context, and avoid replacement copy or workflow metadata.
- [ ] Run focused tests green and commit.

### Task 3: Enforce revision resolution and runtime wiring

**Files:**
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/agent_models.py`
- Modify: `agent/tests/test_noni_dara_loop.py`
- Modify: `agent/tests/test_agent_team.py`
- Modify: `agent/tests/test_cost_reporting.py`

**Interfaces:**
- Consumes: `EditorialAssessment` from ADK.
- Produces: deterministic `EditorialReview` records in `DraftWorkflowResult` with exact prior-issue resolution and no third pass.

- [ ] Write failing tests proving original assessments resolve nothing, accepted revisions resolve exactly every prior issue, rejected revisions may resolve only known subsets, and missing resolutions cannot advance.
- [ ] Run focused tests red.
- [ ] Change Dara's ADK output schema/key, materialize reviews after each invocation, and preserve separate cost/operation identities.
- [ ] Keep the final second-review stopping condition deterministic and fail closed.
- [ ] Run focused runtime tests green and commit.

### Task 4: Persist and render the complete review ledger

**Files:**
- Modify: `src/lib/contracts.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/components/studio/SourcesWorkspace.tsx`
- Modify: `tests/contracts.test.ts`
- Modify: `tests/noniProductionUi.test.ts`

**Interfaces:**
- Consumes: rubric-bearing `DraftWorkflowResult`.
- Produces: schema-validated persisted trace and operator-visible checks, issues, resolutions, and deterministic timestamps.

- [ ] Write failing TypeScript/UI tests for review-check persistence, all-dimension rendering, failed issue provenance, resolved issue IDs, and canonical trace acceptance.
- [ ] Run focused tests red.
- [ ] Extend Zod/type parity and render the review ledger from persisted truth without fallbacks.
- [ ] Run focused tests green and commit.

### Task 5: Expand evaluations and correct current documentation

**Files:**
- Modify: `agent/harmonia_agent/evaluation_contracts.py`
- Modify: `agent/evals/contracts.evalset.json`
- Create: `agent/evals/dara_contract_cases.json`
- Modify: `agent/tests/test_evaluation_contracts.py`
- Modify: `agent/tests/test_evaluation_runner.py`
- Modify: `README.md`
- Modify: `docs/agent-platform.mdx`
- Modify: `docs/architecture-explorer.mdx`
- Modify: `docs/architecture.mdx`
- Modify: `docs/models-cost-evaluation.mdx`
- Modify: `docs/pipeline.mdx`
- Modify: `src/lib/architecture/data.ts`
- Modify: `tests/architectureData.test.ts`

**Interfaces:**
- Produces: source-neutral Dara eval cases and current architecture labels.

- [ ] Write failing eval/docs tests for good review, missed defect/false acceptance, missing rubric, invented reference, invalid path, replacement copy, authority overreach, complete revision resolution, ignored issue, and attempted third pass.
- [ ] Run focused tests red.
- [ ] Implement public fixtures/evaluators and remove remaining Flo/planner ambiguity from current docs and architecture data.
- [ ] Run focused tests green and commit.

### Task 6: Verify, audit, and integrate

**Files:**
- Inspect every branch change and repository status.

**Interfaces:**
- Produces: verified Dara feature branch ready for local fast-forward merge.

- [ ] Run the complete Python agent suite.
- [ ] Run the complete Vitest application suite.
- [ ] Run ESLint, `tsc --noEmit`, and the production Next.js build.
- [ ] Run `git diff --check`, inspect the full diff critically for authority, provenance, schema parity, persistence, and unrelated changes, then fix any defect test-first.
- [ ] Commit the verified result, fast-forward local `main`, rerun merged suites, and clean only this worktree/branch.
