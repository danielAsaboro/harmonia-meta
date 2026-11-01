# Non-Submission Product Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This side conversation forbids sub-agents, so execution must remain inline.

**Goal:** Make every repository-exposed Harmonia capability truthful, durably executable, independently verifiable, and consistent across operator surfaces without performing deployment or submission work.

**Architecture:** Replace X-only draft production with a typed content-artifact pipeline backed by one capability registry, format-specific producer/reviewer contracts, immutable exports, and optional approval-gated X/LinkedIn publishers. Repair steering so every rewind or nudge atomically creates recoverable stage delivery, and harden scheduled libraries with preflight policy, budget reservations, artifact read-back, and retry classification.

**Tech Stack:** TypeScript, Zod, Next.js 16, Firestore, Pub/Sub outbox, Python 3, Pydantic, Google ADK/Gemini, official X and LinkedIn APIs, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-08-30-nonsubmission-product-hardening-design.md`

## Global Constraints

- Do not preserve backward compatibility unless explicitly requested.
- Delete replaced X-only and video-first contracts, aliases, adapters, and fallbacks.
- No mocks, placeholders, fake integrations, or simulated success in shipped behavior.
- Human approval remains mandatory for every external publication and metered generative-media effect.
- Every external action is idempotent and produces an immutable receipt plus independent verification.
- Live provider execution, deployment, evidence capture, and submission artifacts are outside this plan.
- Use red-green-refactor for every production behavior change.

---

### Task 1: Canonical content artifacts and capability registry

**Files:**
- Create: `src/lib/contentArtifacts/contracts.ts`
- Create: `src/lib/contentArtifacts/digest.ts`
- Create: `src/lib/outputCapabilities.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/contracts.ts`
- Modify: `src/lib/outputPlanning.ts`
- Test: `tests/contentArtifactContracts.test.ts`
- Test: `tests/outputCapabilities.test.ts`
- Test: `tests/outputPlanning.test.ts`

**Interfaces:**
- Produces: `ContentArtifact`, `contentArtifactSchema`, `contentArtifactDigest(artifact)`, `OUTPUT_CAPABILITIES`, `availableOutputKinds(context)`.
- Consumes: existing `OutputKind`, `NormalizedSource`, `CampaignOutputPlan`, and source-reference conventions.

- [ ] **Step 1: Write failing schema and digest tests**

Add fixtures for every output payload and assert strict parsing, stable canonical SHA-256, digest changes on payload/revision/lineage changes, rejection of duplicate thread/slide/section IDs, and rejection of evidence references outside the manifest. The core expectation must resemble:

```ts
const artifact = contentArtifactSchema.parse({
  id: "artifact-1", jobId: "job-1", outputPlanId: "plan-1",
  outputPlanDigest: "a".repeat(64), outputType: "newsletter", revision: 1,
  title: "Launch note", sourceSegmentRefs: ["source-1:seg-1"],
  producer: { role: "noni_copywriter", model: "gemini-3.5-flash", traceId: "b".repeat(32) },
  review: { role: "dara_editor", traceId: "c".repeat(32), decision: "accept" },
  mimeType: "text/markdown", createdAt: "2026-08-30T00:00:00.000Z",
  payload: { kind: "newsletter", subject: "Launch", preheader: "What changed", introduction: "Intro", sections: [{ id: "s1", heading: "Proof", body: "Body", sourceSegmentRefs: ["source-1:seg-1"] }], cta: "Try it" },
});
expect(contentArtifactDigest(artifact)).toMatch(/^[0-9a-f]{64}$/);
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx vitest run tests/contentArtifactContracts.test.ts tests/outputCapabilities.test.ts tests/outputPlanning.test.ts`

Expected: failures because the artifact modules and registry do not exist and the planner accepts unregistered promises.

- [ ] **Step 3: Implement strict discriminated schemas and canonical digesting**

Define typed payloads for X post/thread, LinkedIn post, blog article, newsletter, caption, carousel, quote card, diagram, editorial calendar, and content-pack manifest. Canonicalize object keys and preserve array order where order is semantic. Do not retain `ContentDraft` as an alias for the new envelope.

- [ ] **Step 4: Implement the capability registry and planner validation**

Use a complete `satisfies Record<OutputKind, OutputCapability>` registry. Each entry declares `state`, prerequisites, approval class, cost class, exportability, and publisher requirement. `proposeOutputPlan` must derive eligibility from the registry and reject `unavailable` outputs instead of silently dropping them.

- [ ] **Step 5: Run focused and contract tests and verify GREEN**

Run: `npx vitest run tests/contentArtifactContracts.test.ts tests/outputCapabilities.test.ts tests/outputPlanning.test.ts tests/contracts.test.ts`

- [ ] **Step 6: Commit**

```bash
git add src/lib/contentArtifacts src/lib/outputCapabilities.ts src/lib/types.ts src/lib/contracts.ts src/lib/outputPlanning.ts tests/contentArtifactContracts.test.ts tests/outputCapabilities.test.ts tests/outputPlanning.test.ts
git commit -m "feat: define verified content artifact capabilities"
```

### Task 2: Multi-format Noni production and Dara review

**Files:**
- Create: `agent/harmonia_agent/content_artifacts.py`
- Create: `agent/harmonia_agent/content_production.py`
- Modify: `agent/harmonia_agent/agent_models.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/noni_prompt.py`
- Modify: `agent/harmonia_agent/role_models.py`
- Delete or replace X-only portions: `agent/harmonia_agent/noni_skills.py`
- Test: `agent/tests/test_content_artifacts.py`
- Test: `agent/tests/test_content_production.py`
- Modify: `agent/tests/test_noni_contracts.py`

**Interfaces:**
- Consumes: approved `CampaignOutputPlan`, selected editorial item, exact Nimi evidence, brand constraints, and steering instructions.
- Produces: `ProductionBatch(artifacts, reviews, revision_traces)` with one accepted or rejected result per requested output.

- [ ] **Step 1: Write failing Pydantic parity tests**

Mirror the TypeScript artifact payloads and assert strict validation, canonical digest parity for one shared fixture, format limits, evidence-reference validation, and complete output-plan coverage.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_content_artifacts.py tests/test_content_production.py -q`

Expected: import or validation failures because the generalized contracts do not exist.

- [ ] **Step 3: Implement producer inputs and typed output batches**

Replace `platform="x", format="text_post"` with exact requested output specifications. Provide Noni a JSON schema that requires one result for each requested artifact ID and forbids unrequested formats, action authority, destination invention, and unsupported evidence.

- [ ] **Step 4: Implement format-specific Dara checks and one revision maximum**

Share grounding, brand, safety, CTA, and clarity checks. Add format checks for X length and thread ordering, LinkedIn structure, article/newsletter section completeness, carousel slide limits, verbatim quote attribution, diagram entity/edge support, and calendar artifact references. Rejected artifacts must not enter the accepted batch.

- [ ] **Step 5: Run focused tests and the existing Noni/Dara suites**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_content_artifacts.py tests/test_content_production.py tests/test_noni_contracts.py tests/test_agent_team.py -q`

- [ ] **Step 6: Commit**

```bash
git add agent/harmonia_agent agent/tests/test_content_artifacts.py agent/tests/test_content_production.py agent/tests/test_noni_contracts.py
git commit -m "feat: produce and review multiformat content"
```

### Task 3: Persist immutable artifacts and derive truthful actions

**Files:**
- Create: `src/lib/contentArtifacts/repository.ts`
- Create: `src/app/api/internal/content-artifacts/route.ts`
- Modify: `src/app/api/internal/drafts/route.ts`
- Modify: `src/lib/firestore.ts`
- Modify: `src/lib/types.ts`
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `agent/harmonia_agent/web_client.py`
- Test: `tests/contentArtifactRepositoryFirestore.integration.test.ts`
- Test: `tests/contracts.test.ts`
- Modify: `agent/tests/test_agent_stages.py`

**Interfaces:**
- Produces: immutable `content_artifacts/{artifactId}/revisions/{revision}` records and `saveProductionBatch(jobId, batch)`.
- Action derivation: accepted artifacts produce `export_content_artifact`; X artifacts optionally produce X actions; connected LinkedIn posts optionally produce LinkedIn actions.

- [ ] **Step 1: Write failing persistence and action-derivation tests**

Assert create-only revisions, digest conflict rejection, exact output-plan binding, no action for rejected artifacts, export action for every accepted artifact, no LinkedIn publish action without a valid destination, and stable action IDs derived from artifact ID plus digest.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/contentArtifactRepositoryFirestore.integration.test.ts tests/contracts.test.ts && cd agent && ./.venv/bin/python -m pytest tests/test_agent_stages.py -q`

- [ ] **Step 3: Implement repository and internal submission boundary**

Persist authoritative IDs/digests server-side in a transaction. Reject a batch that omits a planned output, includes an unplanned output, references an unknown source segment, or proposes an action not derivable from accepted artifacts.

- [ ] **Step 4: Replace X-only `run_draft` action construction**

Call the generalized production team with the output plan, post the typed batch, and derive only registry-backed actions. Remove the rule requiring exactly one `publish_x_post` action.

- [ ] **Step 5: Verify GREEN and run Firestore integration coverage**

Run: `npm run test:integration` and `cd agent && ./.venv/bin/python -m pytest tests/test_agent_stages.py -q`

- [ ] **Step 6: Commit**

```bash
git add src/lib/contentArtifacts src/app/api/internal/content-artifacts src/app/api/internal/drafts/route.ts src/lib/firestore.ts src/lib/types.ts agent/harmonia_agent/stages.py agent/harmonia_agent/web_client.py tests agent/tests/test_agent_stages.py
git commit -m "feat: persist multiformat production batches"
```

### Task 4: Deterministic export and independent artifact verification

**Files:**
- Create: `agent/harmonia_agent/artifact_export.py`
- Create: `src/app/api/internal/content-artifacts/[id]/route.ts`
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `src/lib/contracts.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/policy.ts`
- Test: `agent/tests/test_artifact_export.py`
- Test: `tests/contentArtifactVerificationFirestore.integration.test.ts`
- Modify: `tests/policy.test.ts`

**Interfaces:**
- Produces: deterministic `render_markdown(ContentArtifact) -> bytes`, `render_json(ContentArtifact) -> bytes`, and `export_content_artifact` receipts containing both byte digests.
- Verifies: object read-back, byte hashes, JSON schema parse, artifact identity, revision, and canonical digest.

- [ ] **Step 1: Write failing serializer golden tests and verification tests**

Assert deterministic output for every payload kind, no timestamps generated during rendering, escaping of headings/links, content-pack constituent checks, and a failed verification for missing or mutated bytes.

- [ ] **Step 2: Verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_artifact_export.py -q` and `npm run test:integration`.

- [ ] **Step 3: Implement serializers, action policy, execution, receipts, and read-back**

Store Markdown and canonical JSON as separate immutable objects. The receipt artifact references the JSON identity and includes both hashes in detail. The verifier must fetch stored objects rather than trust Firestore payload copies.

- [ ] **Step 4: Replace legacy content-pack assembly**

Make a content pack a manifest over verified constituent artifact IDs/digests and deterministic rendered bundle. Delete the old moments/angles/drafts prose pack path.

- [ ] **Step 5: Verify GREEN**

Run focused Python tests, `npm run test:integration`, and `npx vitest run tests/policy.test.ts tests/contracts.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add agent/harmonia_agent/artifact_export.py agent/harmonia_agent/stages.py agent/tests/test_artifact_export.py src/app/api/internal/content-artifacts src/lib/contracts.ts src/lib/types.ts src/lib/policy.ts tests
git commit -m "feat: export and verify content artifacts"
```

### Task 5: X threads and official LinkedIn publication

**Files:**
- Create: `agent/harmonia_agent/linkedin_client.py`
- Modify: `agent/harmonia_agent/x_client.py`
- Modify: `agent/harmonia_agent/effect_executor.py`
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `src/lib/contracts.ts`
- Modify: `src/lib/policy.ts`
- Modify: `src/lib/publishing/contracts.ts`
- Test: `agent/tests/test_x_thread_execution.py`
- Test: `agent/tests/test_linkedin_client.py`
- Test: `tests/linkedinPublishingContracts.test.ts`

**Interfaces:**
- Produces: `publish_x_thread` with ordered per-post progress and `publish_linkedin_post` with destination-bound payload.
- LinkedIn read-back: `get_post(post_id, destination, token)` returns authoritative text and provider URL.

- [ ] **Step 1: Write failing X partial-progress and LinkedIn contract tests**

Cover sequential reply IDs, durable progress resume before each post, uncertainty after ambiguous responses, member versus organization author URNs, exact destination binding, approval requirement, response validation, and text digest read-back.

- [ ] **Step 2: Verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_x_thread_execution.py tests/test_linkedin_client.py -q` and `npx vitest run tests/linkedinPublishingContracts.test.ts tests/policy.test.ts`.

- [ ] **Step 3: Implement official adapters and verification**

Use stored OAuth connections only. X thread execution persists each confirmed provider ID before the next call. LinkedIn execution posts the exact accepted artifact body to the approved member or organization destination. Both record content digests and verify through fresh official reads.

- [ ] **Step 4: Remove unsupported publisher promises**

Delete unused Instagram/YouTube publication action types from generic content-production contracts unless an existing fully implemented path independently satisfies the registry rule. Do not retain enum-only compatibility entries.

- [ ] **Step 5: Verify GREEN**

Run focused tests plus `agent/tests/test_effect_executor.py`, `tests/effectCommands.test.ts`, and `tests/effectClaimContracts.test.ts`.

- [ ] **Step 6: Commit**

```bash
git add agent/harmonia_agent src/lib/contracts.ts src/lib/policy.ts src/lib/publishing tests agent/tests
git commit -m "feat: publish verified X threads and LinkedIn posts"
```

### Task 6: Complete truthful operator surfaces

**Files:**
- Modify: `src/components/studio/OutputIntentSelector.tsx`
- Modify: `src/components/studio/SourcesWorkspace.tsx`
- Modify: `src/components/studio/ArtifactBoard.tsx`
- Modify: `src/components/studio/WorkingCanvas.tsx`
- Modify: `src/components/ChatConsole.tsx`
- Modify: `src/lib/chatIntent.ts`
- Modify: `src/lib/chatHandler.ts`
- Modify: `agent/harmonia_agent/telegram_bot.py`
- Modify: `src/lib/a2ui/presentationContext.ts`
- Modify: `src/lib/a2ui/hydrateSurfacePlan.ts`
- Test: `tests/outputIntentSelector.test.tsx`
- Test: `tests/chatMultiformat.test.ts`
- Modify: `agent/tests/test_telegram_bot.py`

**Interfaces:**
- Consumes: `OUTPUT_CAPABILITIES` and persisted `ContentArtifact` summaries.
- Displays: `verified_export`, `publish_when_connected`, and unavailable states without implying provider success.

- [ ] **Step 1: Write failing UI/chat/Telegram consistency tests**

Assert all selectable types come from the registry, unavailable outputs are rejected, LinkedIn explains connection gating, artifacts show format/revision/digest/verification, and Telegram routes desired formats through the same chat handler without text authorization.

- [ ] **Step 2: Verify RED**

Run the focused Vitest and pytest files.

- [ ] **Step 3: Implement registry-driven surfaces and artifact previews**

Render format-aware previews for thread posts, LinkedIn, article sections, newsletter metadata, carousel slides, quote cards, diagrams, and calendars. Keep external publish controls in the server-owned approval dock.

- [ ] **Step 4: Verify GREEN and accessibility constraints**

Run focused tests, component contract tests, ESLint, and TypeScript.

- [ ] **Step 5: Commit**

```bash
git add src/components src/lib/chatIntent.ts src/lib/chatHandler.ts src/lib/a2ui agent/harmonia_agent/telegram_bot.py tests agent/tests/test_telegram_bot.py
git commit -m "feat: expose truthful multiformat operations"
```

### Task 7: Repair durable steering delivery and UI

**Files:**
- Modify: `src/lib/firestore.ts`
- Modify: `src/lib/steering/repository.ts`
- Modify: `src/lib/steering/lineage.ts`
- Modify: `src/app/api/jobs/[id]/steering/redo/route.ts`
- Modify: `src/app/api/jobs/[id]/steering/nudges/[nudgeId]/apply/route.ts`
- Modify: `src/components/studio/SteeringControls.tsx`
- Create: `tests/steeringFirestore.integration.test.ts`
- Modify: `tests/steeringLineage.test.ts`

**Interfaces:**
- Produces: `rewindJobStageWithOutbox(...) -> { controlEpoch, outboxId }` and `applyNudgeWithOutbox(...)`.
- Preserves: executed actions, receipts, effect claims, and verification records.

- [ ] **Step 1: Write failing Firestore integration tests**

Assert redo atomically changes stage and creates attempt-scoped pending outbox, stale epochs fail, unsafe rewind after executed effects fails, safe rewind invalidates only dependent unexecuted artifacts/approvals, nudge resumes through outbox, and durable dispatch can recover after route failure.

- [ ] **Step 2: Verify RED with the Firestore emulator**

Run: `npm run test:integration`.

- [ ] **Step 3: Implement atomic rewind/nudge transactions and dispatch**

Use epoch or rewind decision ID in outbox identity so an earlier published attempt cannot suppress the new trigger. Return the outbox ID and dispatch only after commit; retain pending state for durable-tick recovery.

- [ ] **Step 4: Complete cancel and redo controls**

Add explicit impact review and exact typed confirmation. Never use a generic confirm dialog as authority. Reload only after the server returns the new epoch and persisted decision.

- [ ] **Step 5: Verify GREEN**

Run Firestore integration, steering unit tests, TypeScript, and lint.

- [ ] **Step 6: Commit**

```bash
git add src/lib/firestore.ts src/lib/steering src/app/api/jobs/[id]/steering src/components/studio/SteeringControls.tsx tests/steeringFirestore.integration.test.ts tests/steeringLineage.test.ts
git commit -m "fix: make steering durably resumable"
```

### Task 8: Enforce brand-library preflight, budget, and recovery

**Files:**
- Create: `agent/harmonia_agent/extraction/preflight.py`
- Modify: `agent/harmonia_agent/extraction_api.py`
- Modify: `src/lib/brandLibraries/sync.ts`
- Modify: `src/lib/brandLibraries/repository.ts`
- Modify: `src/lib/brandLibraries/contracts.ts`
- Modify: `src/app/api/internal/libraries/sync/route.ts`
- Test: `agent/tests/test_extraction_preflight.py`
- Create: `tests/brandLibrarySyncFirestore.integration.test.ts`
- Modify: `tests/brandLibraryContracts.test.ts`

**Interfaces:**
- Produces: bounded metadata `ExtractionEstimate(bytes, characters_upper_bound, media_duration_seconds, estimated_cost_usd)` before model invocation.
- Sync result: typed healthy, transient failure with `nextEligibleRetryAt`, or reconnection-required failure.

- [ ] **Step 1: Write failing preflight and recovery tests**

Cover declared byte/file excess, unsupported MIME, unmeasurable media duration, duration excess before Gemini, deterministic budget reservation IDs, missing reusable artifact, empty folder, transient backoff, reconnection suppression, partial failure, and preservation of the last healthy snapshot.

- [ ] **Step 2: Verify RED**

Run focused Python tests and `npm run test:integration`.

- [ ] **Step 3: Implement bounded extraction estimate and pre-spend reservation**

Use ffprobe for downloaded media metadata before Gemini, fail closed when duration cannot be measured, reserve estimated model cost before extraction, and reconcile observed usage afterward. Written inputs must enforce byte and expansion ceilings before any model call.

- [ ] **Step 4: Implement retry classification and reusable-artifact read-back**

Verify normalized artifact existence and digest before reuse. Persist typed failure category, retry count, and next eligible retry timestamp. Never promote partial or empty snapshots.

- [ ] **Step 5: Verify GREEN**

Run focused tests, full Firestore integration, scheduler tests, and cost-reporting tests.

- [ ] **Step 6: Commit**

```bash
git add agent/harmonia_agent/extraction agent/harmonia_agent/extraction_api.py agent/tests/test_extraction_preflight.py src/lib/brandLibraries src/app/api/internal/libraries tests
git commit -m "fix: enforce scheduled library policy before spend"
```

### Task 9: Remove stale contracts and align documentation

**Files:**
- Modify: `README.md`
- Modify: `docs/pipeline.mdx`
- Modify: `docs/architecture/overview.mdx`
- Modify: `docs/operational-model.mdx`
- Modify: `docs/a2ui-console.mdx`
- Modify: `docs/architecture-explorer.mdx`
- Modify: `src/lib/architecture/data.ts`
- Modify: `src/docs-architecture-flow.tsx`
- Regenerate: `docs/architecture-flow.js`
- Create: `tests/productCapabilityDocumentation.test.ts`
- Modify: affected fixtures across `tests/` and `agent/tests/`

**Interfaces:**
- Documentation names exact artifact states, implemented publishers, approval rules, and external evidence limitations.
- Legacy scan returns only explicit negative assertions and historical specs/plans.

- [ ] **Step 1: Write failing documentation and legacy-surface tests**

Assert public docs contain the capability states and verified export boundary; reject claims that every format publishes; reject X-only `CopywriterInput`, legacy generic packs, inert redo, old ingest/transcribe stages, and compatibility aliases in production paths.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/productCapabilityDocumentation.test.ts`.

- [ ] **Step 3: Update all current product surfaces and regenerate architecture output**

Historical specs and plans remain historical. Current README, docs, architecture explorer, route inventories, and runtime descriptions must match shipped contracts exactly.

- [ ] **Step 4: Run the legacy/capability scan**

Run:

```bash
rg -n 'transcriptSegments|mediaAttachmentId|run_ingest|run_transcribe|platform: "x"|format: "text_post"|Compatibility display alias|publish_instagram_post|publish_youtube_video' src agent/harmonia_agent tests agent/tests README.md docs --glob '!docs/superpowers/**' --glob '!docs/architecture-flow.js'
```

Expected: no production compatibility surface; only deliberate negative tests or truthful integration documentation.

- [ ] **Step 5: Commit**

```bash
git add README.md docs src/lib/architecture/data.ts src/docs-architecture-flow.tsx tests agent/tests
git commit -m "docs: align product contracts and capabilities"
```

### Task 10: Full verification and closure audit

**Files:**
- Modify only files required to fix failures exposed by the commands below.

**Interfaces:**
- Produces: clean branch with repository-local acceptance evidence and an explicit list limited to external blockers.

- [ ] **Step 1: Run TypeScript gates sequentially**

Run: `npx tsc --noEmit && npm test && npm run lint && npm run build`

Expected: all pass. Do not run `tsc` concurrently with `next build` because both mutate `.next/types`.

- [ ] **Step 2: Run Python gates**

Run: `cd agent && ./.venv/bin/python -m pytest -q`

Expected: all pass; warnings must be understood and must not conceal failures.

- [ ] **Step 3: Run Firestore integration**

Run: `npm run test:integration`

Expected: all integration files pass against the local emulator.

- [ ] **Step 4: Run repository hygiene checks**

Run: `git diff --check`, the Task 9 legacy scan, `git status --short`, and inspect every remaining diff.

- [ ] **Step 5: Correct every repository-local P0/P1 issue found by the closure audit**

For each defect, first add a focused failing regression test, verify RED, implement the minimum correction, and verify GREEN. Do not convert credentials, deployment, or live-provider evidence into fake repository work.

- [ ] **Step 6: Commit verification fixes**

```bash
git add -A
git commit -m "test: close product hardening verification"
```

- [ ] **Step 7: Report the truthful completion boundary**

Report exact passing counts, build result, commit IDs, and only these permitted external categories if still absent: credentials, authenticated provider execution, cloud resources/deployment, evidence capture, demo, submission copy, eligibility, and deadline freeze.
