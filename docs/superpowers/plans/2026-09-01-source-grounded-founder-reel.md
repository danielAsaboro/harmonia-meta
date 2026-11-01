# Source-Grounded Founder Reel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend Harmonia's sealed production graph so a vertical reel can be assembled primarily from multiple evidence-bound excerpts of one verified source video, with original speech, captions, and deterministic reframing.

**Architecture:** Keep the full licensed source as one immutable verified artifact. Each source-backed production scene seals its own media window and cited Nimi source-segment identities; the worker repeats that artifact on the authored timeline using HyperFrames `data-media-start`, preserves source audio, and renders captions/reframing deterministically. Generated Veo scenes remain separate paid operations and cannot be substituted for source excerpts.

**Tech Stack:** TypeScript/Zod production contracts and Firestore plan store; Python worker, HyperFrames 0.8.x, ffmpeg/ffprobe; Vitest and pytest.

**Spec:** `/Users/MAC/development/wip/allthingsagentichackathon/submission/harmonia-submission-demo-script.md` plus the delegated Steve Wozniak reel brief in task history.

## Global Constraints

- Use the complete `https://www.youtube.com/watch?v=920QAxtook8` source and record CC BY 3.0 attribution.
- Target a grounded 45–75 second, 9:16 founder reel built primarily from selected source excerpts.
- Preserve speaker meaning and bind excerpts/captions to timestamped Nimi evidence.
- Allow at most two short Veo B-roll shots, and submit none before a separately approved immutable plan revision and exact maximum cost.
- Keep publication unauthorized.
- Keep the worker at max instances 1 and concurrency 1.
- Do not introduce compatibility fallbacks or simulate successful providers.

---

### Task 1: Seal source excerpt and caption lineage

**Files:**
- Modify: `src/lib/mediaProduction.ts`
- Test: `tests/mediaProduction.test.ts`

**Interfaces:**
- Consumes: existing `VerifiedProductionArtifactRef` and Nimi source-segment IDs.
- Produces: strict source-backed scene fields `sourceWindow`, `sourceSegmentRefs`, `preserveSourceAudio`, `reframe`, and timed caption records; generated scenes reject source-only fields.

- [ ] **Step 1: Write failing schema and graph tests**

Add tests proving that a source scene accepts a positive bounded window, non-empty evidence references, original audio, deterministic reframe values, and timed captions; reject missing lineage, out-of-window captions, and source-only fields on Veo scenes.

- [ ] **Step 2: Run the focused test and verify failure**

Run: `npx vitest run tests/mediaProduction.test.ts`

- [ ] **Step 3: Implement the strict scene contract**

Add Zod schemas and cross-field checks. Make the build-composition request digest include the fully parsed plan digest, preserving immutable authorization.

- [ ] **Step 4: Run the focused test and verify success**

Run: `npx vitest run tests/mediaProduction.test.ts`

- [ ] **Step 5: Commit**

Commit message: `feat: seal source-grounded reel scenes`

### Task 2: Compile source cuts, speech, captions, and reframing

**Files:**
- Modify: `agent/harmonia_agent/production_media.py`
- Modify: `agent/harmonia_agent/production_executor.py`
- Test: `agent/tests/test_production_media.py`
- Test: `agent/tests/test_production_executor.py`

**Interfaces:**
- Consumes: the strict source scene fields from Task 1 and verified resolved MP4 bytes.
- Produces: deterministic HyperFrames markup with authored `data-start`, source `data-media-start`, conditional source audio, bounded caption clips, and inner transform wrappers for vertical reframing.

- [ ] **Step 1: Write failing compiler tests**

Assert repeated cuts from one file have distinct `data-media-start` values, source speech is not muted, generated B-roll is muted unless its sealed spec generated audio, captions stay inside their scene, and reframe transforms are deterministic.

- [ ] **Step 2: Run focused Python tests and verify failure**

Run: `cd agent && .venv/bin/pytest tests/test_production_media.py tests/test_production_executor.py -q`

- [ ] **Step 3: Implement the compiler and executor mapping**

Carry the sealed fields into the constrained compiler. Escape all text and attributes, reject window overflow, and preserve the existing workspace/path boundary.

- [ ] **Step 4: Run focused Python tests and verify success**

Run: `cd agent && .venv/bin/pytest tests/test_production_media.py tests/test_production_executor.py -q`

- [ ] **Step 5: Commit**

Commit message: `feat: render evidence-bound source excerpts`

### Task 3: Verify, deploy, and run the unpaid pipeline

**Files:**
- Update only implementation/tests required by failures discovered in verification.
- Store real evidence under parent-level `submission/`, never in the public repository.

**Interfaces:**
- Consumes: Tasks 1–2 and the existing durable job/production-plan routes.
- Produces: deployed web and worker revisions, a real source job, timestamped Nimi moments, and a sealed production plan awaiting paid approval only if Veo is present.

- [ ] **Step 1: Run full verification**

Run TypeScript tests, Firestore integration tests, lint, `npx tsc --noEmit`, Next build, full Python tests, and `git diff --check`.

- [ ] **Step 2: Deploy the web and worker images**

Build immutable images from the committed revisions, deploy at 100% traffic, and confirm the worker remains max scale 1, concurrency 1, memory 2 GiB.

- [ ] **Step 3: Ingest and analyze the complete licensed source**

Create one real job with the required attribution and license URLs, drive durable ticks, and verify persisted source digest, transcription, timestamped segments, Nimi moments, strategy, plan, Noni drafts, and Dara review.

- [ ] **Step 4: Construct and seal the editorial production plan**

Choose 45–75 seconds of evidence-backed source windows, include captions and reframes, and add zero to two Veo scenes only when source visuals are insufficient. Verify the exact plan digest and price quote.

- [ ] **Step 5: Stop at the mandatory boundary**

If paid operations exist, report one approval prompt containing revision, digest, exact maximum cost, and operation list. If cost is exactly zero, continue through render/QA/export without requesting paid approval. Do not publish.

## Self-Review

- Spec coverage: source licensing, full ingestion, evidence-bound moments, multi-excerpt timeline, captions, reframing, optional capped Veo, Dara QA, deployment, and no publication are covered.
- Placeholder scan: no deferred implementation fields or simulated paths.
- Type consistency: the same sealed scene fields flow from TypeScript schema to Python executor to HyperFrames compiler.
