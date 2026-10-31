# Noni Copywriter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Noni produce one strictly typed, evidence-grounded, brief-aligned draft and at most one traceable revision for the selected Temi item.

**Architecture:** Deterministic code assembles an immutable `CopywriterInput` from the accepted editorial plan and approved strategy history. A focused tool-free Noni ADK agent returns one `ContentDraft`; deterministic validators enforce lineage, brief alignment, claim provenance, platform limits, constraints, and authority boundaries before a structured Dara review and one optional revision.

**Tech Stack:** Google ADK, Pydantic, Python pytest, TypeScript, Zod, Firestore transactions, Vitest, Next.js.

**Spec:** `docs/superpowers/specs/2026-08-27-noni-copywriter-design.md`

## Global Constraints

- Firestore is durable workflow truth; agent session state is ephemeral.
- Noni receives only one selected Temi item, its exact approved Ryan brief, and referenced Nimi evidence.
- Noni and Dara have no tools and no strategy, planning, approval, scheduling, publishing, receipt, credential, or workflow-mutation authority.
- Every factual claim must map to supplied evidence; insufficient evidence means omission or a clearly non-factual creative assumption.
- Deterministic code owns validation, revision count, persistence, effect construction, approval, publishing, and verification.
- Exactly one automatic Noni revision is permitted after Dara requests changes.
- X is the only currently supported production platform and text remains at most 280 characters.
- Make clean contract cuts; add no aliases, adapters, migrations, dual reads, mocks, placeholders, or fake success paths.
- Make no paid model/cloud calls, deployments, publishing, or authenticated capture.

---

### Task 1: Strict Noni and Dara contracts

**Files:**
- Modify: `agent/harmonia_agent/agent_models.py`
- Create: `agent/tests/test_noni_contracts.py`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/contracts.ts`
- Create: `tests/noniContracts.test.ts`

**Interfaces:**
- Produces: `CopywriterInput`, `ContentClaim`, `ContentDraft`, `EditorialReviewIssue`, and `EditorialReview` with matching strict Python, Zod, and TypeScript shapes.
- Removes: thin `Draft`, `DraftSet`, and legacy production input semantics from the Noni/Dara boundary.

- [ ] Write failing Python contract tests for a complete original input/draft, complete revision input, exact lineage, one supported platform/format, one output, claim mappings, assumptions/confidence, applied constraints, prior-draft linkage, and addressed issue IDs.
- [ ] Add failing strictness tests rejecting extra fields, arrays of alternative posts, mismatched item/brief/evidence, revision context on an original pass, missing prior draft/review on revision, unsupported platform/format, invalid confidence, authority/effect/receipt fields, and text over 280 characters.
- [ ] Run `../../../agent/.venv/bin/python -m pytest -q tests/test_noni_contracts.py` and confirm failures arise from missing contracts.
- [ ] Implement the smallest closed-world Pydantic types and validators; remove the old thin draft types rather than aliasing them.
- [ ] Add equivalent Zod fixtures and boundary-parity tests, including blank/list item limits and strict UTC/ID fields where applicable.
- [ ] Run focused Python and Vitest suites until green, run `tsc --noEmit`, and commit `feat: define strict Noni production contracts`.

### Task 2: Focused Noni prompt and grounding validator

**Files:**
- Create: `agent/harmonia_agent/noni_prompt.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/tests/test_noni_contracts.py`
- Modify: `agent/tests/test_agent_team.py`

**Interfaces:**
- Consumes: `CopywriterInput` and `ContentDraft` from Task 1.
- Produces: `validate_content_draft(input: CopywriterInput, draft: ContentDraft) -> ContentDraft` and a tool-free `noni_copywriter` ADK agent.

- [ ] Add failing tests for unknown/missing evidence, uncited factual statements, textually unsupported claim terms, invented metrics/trends/testimonials/capabilities, objective/audience/funnel/CTA/format divergence, missing constraints, exclusions/safety violations, invented URLs, multiple final alternatives, and approval/schedule/publish/effect/receipt/credential overreach.
- [ ] Add passing boundary cases for persuasive but non-factual language, creative assumptions, qualified claims, supplied URLs, and insufficient evidence expressed with reduced confidence.
- [ ] Run focused tests and confirm each red case fails for its intended reason.
- [ ] Implement `noni_prompt.py` with the six-step evidence-first writing/revision method and explicit prohibitions.
- [ ] Implement conservative deterministic claim/brief/constraint validation using exact supplied IDs and normalized supplied evidence text; fail closed without model-based validation.
- [ ] Configure Noni as a tool-free ADK agent with `CopywriterInput`/`ContentDraft` schemas and run focused agent tests.
- [ ] Commit `feat: ground Noni drafts in selected evidence`.

### Task 3: Structured Dara review and bounded revision loop

**Files:**
- Create: `agent/harmonia_agent/dara_prompt.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/agent_models.py`
- Create: `agent/tests/test_noni_dara_loop.py`
- Modify: `agent/tests/test_agent_team.py`

**Interfaces:**
- Produces: deterministic `run_noni_dara_loop(input, invoke_noni, invoke_dara) -> DraftWorkflowResult` with original draft, reviews, optional revision, and accepted draft.
- Dara returns only `EditorialReview`; it never rewrites copy.

- [ ] Add failing tests for accepted original, one requested revision then acceptance, invalid review lineage, invented review evidence, new replacement copy, revision missing issue IDs, ignored required issues, a second revise verdict, empty/duplicate issue IDs, and more than two Noni invocations.
- [ ] Implement focused Dara instructions for grounding, brief alignment, brand, CTA, platform, safety, and clarity review without replacement copy or effect authority.
- [ ] Replace the implicit ADK `LoopAgent` draft-set exchange with explicit bounded orchestration: Noni original → Dara review → optional Noni revision → Dara final review; fail closed if revision 2 is not accepted.
- [ ] Validate each Noni output and Dara review between invocations, preserve immutable IDs/evidence, and return a strict result containing full trace and accepted exact draft.
- [ ] Run focused tests and commit `feat: bound the Noni Dara revision protocol`.

### Task 4: Firestore production wiring and persistence

**Files:**
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `agent/tests/test_temi_stages.py`
- Create: `agent/tests/test_noni_stages.py`
- Modify: `src/lib/firestore.ts`
- Modify: `src/app/api/internal/drafts/route.ts`
- Modify: `src/lib/types.ts`
- Create or modify focused tests under `tests/`.

**Interfaces:**
- Consumes: persisted selected editorial item, matching plan/strategy history, and `DraftWorkflowResult` from Task 3.
- Produces: immutable original/review/revision/final records and atomic editorial-item transition to `awaiting_approval`.

- [ ] Add failing stage tests proving exact immutable `CopywriterInput` construction, plan/strategy/digest/tenant binding, missing evidence failure before Noni, and no access to non-selected plan items.
- [ ] Add failing persistence tests for original/review/revision/final round trips, idempotent retry, stale draft digest rejection, partial-write rollback, and exact final-draft action derivation.
- [ ] Replace legacy `DraftSet` persistence and text-based provenance reconstruction with structured draft/review lineage.
- [ ] Persist production trace, validation results, and final accepted content atomically with item/job lifecycle; make retry reconcile the same digest rather than duplicate records.
- [ ] Ensure deterministic effect proposals use only the accepted exact draft text and remain behind the existing human approval gate.
- [ ] Run focused Python/Vitest, `tsc --noEmit`, and commit `feat: persist grounded Noni production lineage`.

### Task 5: Evaluation fixtures, UI, and current documentation

**Files:**
- Modify: `agent/harmonia_agent/evaluation_contracts.py`
- Modify: `agent/harmonia_agent/evaluation_runner.py`
- Modify: `agent/evals/contracts.evalset.json`
- Add: `agent/evals/noni_contract_cases.json`
- Modify: `agent/tests/test_evaluation_contracts.py`
- Modify: `agent/tests/test_evaluation_runner.py`
- Modify: `src/components/studio/SourcesWorkspace.tsx`
- Modify: `src/components/jobTypes.ts`
- Modify: `README.md`
- Modify: `docs/pipeline.mdx`
- Modify: `docs/architecture.mdx`
- Modify: `docs/agent-platform.mdx`
- Modify: `docs/state-ownership.mdx`
- Modify: `docs/interfaces.mdx`
- Modify: `src/lib/architecture/data.ts`
- Add or modify focused Vitest UI/architecture tests.

**Interfaces:**
- Produces: deterministic Noni evaluation verdicts and persisted-truth UI for original/revision provenance and Dara review state.

- [ ] Add failing evaluation cases for grounded copy, missing/invented evidence, unsupported claims, invented results/trends/testimonials, brief/CTA deviation, exclusions/safety/platform failures, incomplete claims, authority overreach, Memory Bank/general knowledge misuse, successful revision, invalid lineage, ignored issues, and attempted third pass.
- [ ] Implement evaluation classification through schema and deterministic validators, not exact prompt text.
- [ ] Add UI tests for original versus revision text, claim-to-evidence provenance, assumptions, confidence, applied constraints, Dara issues, revision count, and acceptance state from persisted job truth.
- [ ] Update current documentation and architecture labels to Noni's exact single-item copywriting role and structured Dara loop; leave historical specs unchanged.
- [ ] Run focused Python/Vitest, lint, TypeScript, and commit `docs: document grounded Noni production`.

### Task 6: Full verification and branch completion

**Files:**
- Review all changed files only.

**Interfaces:**
- Produces: a verified isolated feature branch ready for local fast-forward integration.

- [ ] Run the complete Python agent suite.
- [ ] Run the complete Vitest application suite.
- [ ] Run ESLint and `tsc --noEmit` sequentially.
- [ ] Run the production Next.js build.
- [ ] Run `git diff --check 5ec1c4f...HEAD`, inspect the complete diff/status, and search for stale thin draft contracts, compatibility aliases, mock/fake paths, secrets, and authority drift.
- [ ] Request independent full-branch review, fix every Critical/Important finding with focused TDD, and rerun affected plus complete verification.
- [ ] Commit the verified result, retain unrelated main-tree untracked files, and fast-forward local `main` only because the user already explicitly requested automatic local integration between agent refinements.
