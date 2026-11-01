# Veo Conditioning Artifacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Veo 3.1 image-to-video and first/last-frame operations execute from immutable, rights-authorized, independently verified production artifacts without duplicate paid submissions.

**Architecture:** Replace conditioning artifact IDs with full sealed artifact references. Compile each reference into an internal `resolve_media` dependency, require those dependencies to succeed before the paid claim can be acquired, download their durable bytes in the paid worker, and pass validated base64 image objects to the official Vertex Veo REST request. Keep reference-image and video-extension modes blocked because the selected GA Veo 3.1 models do not support them.

**Tech Stack:** TypeScript, Zod, Firestore transactions, Python, pytest, Vertex AI Veo REST, ffprobe/ffmpeg media inspection.

**Spec:** `/Users/MAC/.codex/attachments/e192f7bd-b684-4f5c-8059-6cf063b0e933/pasted-text.txt`

## Global Constraints

- Work only in the existing `feature/autonomous-media-engine` worktree.
- Use test-driven development and observe every new behavior fail before implementation.
- Never submit a paid request until the exact sealed dependencies, mandate, budget, and provider-submission authorization are valid.
- Never convert missing, malformed, unauthorized, or unsupported conditioning media into provider success.
- Keep production approval structurally separate from publication approval.
- Remove replaced artifact-ID behavior; do not add compatibility aliases.
- Do not advertise reference-image or extension support without a real selected-model provider path.

---

### Task 1: Seal conditioning artifact identities in the graph

**Files:**
- Modify: `src/lib/mediaProduction.ts`
- Test: `tests/mediaProduction.test.ts`

**Interfaces:**
- Consumes: `VerifiedProductionArtifactRef`.
- Produces: `GeneratedVideoSpec.sourceImageArtifact` and `GeneratedVideoSpec.lastFrameArtifact`; paid Veo operations depend on the corresponding `resolve_media` operations.

- [x] **Step 1: Write failing contract tests**

Add tests proving image-to-video and first/last-frame plans accept only sealed JPEG/PNG references, compile unique `resolve_media` roots, and bind those roots as paid-operation dependencies. Add rejection tests for bare legacy IDs, wrong MIME, conflicting identities, unsupported reference-image mode, and unsupported extension mode.

- [x] **Step 2: Verify RED**

Run: `npm test -- tests/mediaProduction.test.ts`

Expected: FAIL because conditioning references are still bare IDs and Veo 3.1 modes advertise only text-to-video.

- [x] **Step 3: Implement the minimal contract and graph changes**

Allow `image/jpeg` and `image/png` in verified references; replace the legacy ID fields with strict artifact-reference fields; advertise only `text_to_video`, `image_to_video`, and `first_last_frame` for both selected Veo 3.1 capabilities; include conditioning references in identity-conflict validation and graph compilation; make each paid Veo operation depend on its exact resolver operations.

- [x] **Step 4: Verify GREEN**

Run: `npm test -- tests/mediaProduction.test.ts`

Expected: PASS.

### Task 2: Gate paid claims on verified conditioning dependencies

**Files:**
- Modify: `src/lib/productionPlanStore.ts`
- Test: `tests/productionPlanFirestore.integration.test.ts`

**Interfaces:**
- Consumes: paid operation `dependsOn` resolver IDs.
- Produces: `PaidProductionClaimOutcome.inputs`, containing immutable dependency artifact identities.

- [x] **Step 1: Write a failing Firestore integration test**

Create and approve an image-conditioned plan. Prove the resolver is scheduled first, the paid operation cannot be claimed while the resolver is incomplete, completing the resolver schedules the paid operation, and the paid claim returns the exact dependency artifact.

- [x] **Step 2: Verify RED**

Run: `npm run test:integration -- tests/productionPlanFirestore.integration.test.ts`

Expected: FAIL because paid claims currently ignore dependencies and do not return inputs.

- [x] **Step 3: Implement transactional dependency binding**

Read every dependency claim in the same paid-claim transaction, reject incomplete or mismatched dependencies, derive immutable input digests, persist them on the paid claim, and return the inputs for execute/resume/terminal outcomes. Preserve mandate and cost-ceiling checks.

- [x] **Step 4: Verify GREEN**

Run: `npm run test:integration -- tests/productionPlanFirestore.integration.test.ts`

Expected: PASS.

### Task 3: Materialize and submit validated image conditioning

**Files:**
- Modify: `agent/harmonia_agent/production_executor.py`
- Modify: `agent/harmonia_agent/generative_media.py`
- Test: `agent/tests/test_production_executor.py`
- Test: `agent/tests/test_generative_media.py`

**Interfaces:**
- Consumes: paid-claim `inputs` plus sealed conditioning references.
- Produces: Vertex Veo REST `instances[0].image` and optional `instances[0].lastFrame`, each containing validated `bytesBase64Encoded` and exact MIME.

- [x] **Step 1: Write failing provider and executor tests**

Prove the transport emits official image and last-frame objects; the executor downloads only dependency operations named by the sealed references; digest/MIME/size mismatches fail before budget reservation and provider authorization; a resumed Veo operation does not redownload or resubmit conditioning inputs.

- [x] **Step 2: Verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_generative_media.py tests/test_production_executor.py -q`

Expected: FAIL because the transport ignores conditioning media and the paid executor does not bind inputs.

- [x] **Step 3: Implement deterministic conditioning payloads**

Validate image bytes and MIME from the resolver artifacts, base64-encode them in memory, pass only the validated provider-ready objects to `VeoGenerator`, and have `GoogleMediaTransport.start_veo` construct the official REST instance. Do not persist encoded bytes or prompts in provider provenance.

- [x] **Step 4: Verify GREEN**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_generative_media.py tests/test_production_executor.py -q`

Expected: PASS.

### Task 4: Review, complete verification, and commit

**Files:**
- Review every file changed by Tasks 1–3.

**Interfaces:**
- Consumes: the completed conditioning path.
- Produces: one coherent branch checkpoint with unsupported modes still visibly blocked.

- [x] **Step 1: Run focused mutation-oriented review**

Confirm tests fail if dependency binding, digest validation, first/last-frame payload placement, or duplicate-submission protection is removed.

- [x] **Step 2: Run full verification**

Run `npm test`, `npm run test:agent`, `npm run test:integration`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, `git diff --check`, rebuild `harmonia-agent-media:verification`, and run a container smoke that validates a real local image with ffprobe/ffmpeg and exercises payload construction without invoking a paid provider.

- [x] **Step 3: Review against the spec**

Verify production approval remains separate from publication, paid submission stays exact and cost-bounded, reference-image/extension controls remain blocked, and no provider success is simulated.

- [x] **Step 4: Commit**

Stage only scoped files (exclude the unrelated `pnpm-lock.yaml`) and commit with `feat: materialize Veo conditioning artifacts`.
