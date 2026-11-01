# Verified Production Sources Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Materialize sealed source footage and narration from digest-bound tenant artifacts, then feed those verified bytes into the durable HyperFrames composition and voiceover-carve path.

**Architecture:** Replace unsealed source IDs with immutable artifact references containing ID, SHA-256 digest, MIME type, and byte count. Compile one cost-free `resolve_media` operation per referenced artifact; the production API verifies the exact current operation claim and artifact identity before returning bytes. Composition consumes only succeeded resolve-operation artifacts, choosing either verified source footage or generated video per scene and wiring verified narration into HyperFrames.

**Tech Stack:** TypeScript, Zod, Firestore transactions, Next.js route handlers, Google Cloud Storage/local durable artifact storage, Python worker, HyperFrames 0.8.20, ffmpeg/ffprobe, Vitest, pytest.

**Spec:** `/Users/MAC/.codex/attachments/e192f7bd-b684-4f5c-8059-6cf063b0e933/pasted-text.txt`

## Global Constraints

- `VideoProductionPlan` remains the sealed source of truth.
- Production approval and publication approval remain structurally separate.
- Source bytes must match tenant, job, artifact ID, digest, MIME type, and byte count before use.
- `resolve_media` is cost-free and must never carry a production mandate or paid quote.
- Provider text and media bytes must not become shell commands, executable HTML, or paths.
- No compatibility alias for `sourceArtifactIds`; replace it with the sealed artifact-reference contract.
- Use failing tests first and observe the intended failure before implementation.
- Do not push or merge.

---

### Task 1: Seal source and narration artifact identities

**Files:**
- Modify: `src/lib/mediaProduction.ts`
- Modify: `tests/mediaProduction.test.ts`
- Modify: plan fixtures that currently use `sourceArtifactIds`

**Interfaces:**
- Produces: `VerifiedProductionArtifactRef` with `artifactId`, `digest`, `mime`, and `sizeBytes`.
- Produces: scene `sourceArtifact?: VerifiedProductionArtifactRef` and plan `narration: ProductionNarrationClip[]`.
- Produces: deterministic `resolve_media` operations whose payload is the exact sealed artifact reference.

- [ ] **Step 1: Write failing contract tests**

```ts
it("seals verified source and narration artifacts into the operation graph", () => {
  const plan = videoProductionPlanSchema.parse(sourceBackedPlan);
  const operations = compileProductionOperations(plan);
  expect(operations.filter((item) => item.type === "resolve_media").map((item) => item.payload))
    .toEqual([sourceRef, narrationRef]);
  expect(operations.find((item) => item.type === "build_composition")?.dependsOn)
    .toEqual(expect.arrayContaining(operations.filter((item) => item.type === "resolve_media").map((item) => item.id)));
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- tests/mediaProduction.test.ts`

Expected: FAIL because source-backed scenes and narration are not accepted or compiled.

- [ ] **Step 3: Implement the strict replacement contract**

Add a strict artifact-reference schema, require exactly one of `scene.sourceArtifact` or `scene.video`, add bounded narration clips, deduplicate identical references by exact canonical identity, and compile deterministic `resolve_media` roots before paid operations and composition.

- [ ] **Step 4: Update fixtures and verify GREEN**

Run: `npm test -- tests/mediaProduction.test.ts`

Expected: PASS, including rejection of malformed digests, MIME mismatches, identity collisions, and scenes with zero or two media sources.

### Task 2: Authorize and materialize exact source bytes

**Files:**
- Modify: `src/lib/artifactStore.ts`
- Modify: `src/lib/productionPlanStore.ts`
- Create: `src/app/api/internal/production-plans/[planId]/operations/[operationId]/source/route.ts`
- Modify: route/store tests and Firestore integration tests

**Interfaces:**
- Produces: `getProductionSourceArtifact(planId, operationId, claimId, claimToken)` returning the exact sealed artifact record and verified bytes.
- Produces: `ArtifactStore.materialize(id)` which validates ready state, tenant scope, stored digest, and byte count.

- [ ] **Step 1: Write failing store and route tests**

Test that a claimed `resolve_media` operation returns bytes only when artifact ID, job ID, digest, MIME, and byte count match its immutable operation payload. Test wrong tenant/job/digest, expired or wrong claim token, non-resolve operations, missing bytes, and duplicate delivery.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/artifactStore.test.ts tests/productionPlanRoutes.test.ts`

Expected: FAIL because full verified materialization and the claim-bound source route do not exist.

- [ ] **Step 3: Implement materialization and claim binding**

Read the current immutable revision and exact claim inside tenant scope, require an owned active internal claim for the `resolve_media` operation, materialize the artifact through `ArtifactStore`, compare every sealed identity field, and return raw bytes with digest/MIME/size headers.

- [ ] **Step 4: Queue all dependency-free roots on approval**

Change approval scheduling from paid-only roots to every operation with `dependsOn.length === 0`, preserving paid mandate checks for paid operations and internal claim semantics for resolve operations.

- [ ] **Step 5: Verify route, store, and emulator behavior**

Run: `npm test -- tests/artifactStore.test.ts tests/productionPlanRoutes.test.ts tests/productionPlanFirestore.integration.test.ts`

Expected: PASS; duplicate claims reuse the same identity and do not create a second paid submission.

### Task 3: Compose source footage and narration from resolved artifacts

**Files:**
- Modify: `agent/harmonia_agent/web_client.py`
- Modify: `agent/harmonia_agent/production_executor.py`
- Modify: `agent/tests/test_production_executor.py`

**Interfaces:**
- Produces: `download_production_source(...) -> tuple[bytes, str, str]` with response digest verification.
- Consumes: succeeded `resolve_media` operation artifacts as ordinary immutable composition dependencies.

- [ ] **Step 1: Write failing executor tests**

Test that `resolve_media` downloads the exact sealed source and uploads it as the operation result; composition accepts source-only scenes, includes verified narration clips, persists their input digests, and emits a non-empty voiceover-carve manifest. Test wrong MIME and missing resolve dependencies fail visibly.

- [ ] **Step 2: Run focused pytest and verify RED**

Run: `npm run test:agent -- agent/tests/test_production_executor.py`

Expected: FAIL because `resolve_media` is unsupported and composition currently forces generated video and an empty narration list.

- [ ] **Step 3: Implement resolver and composition mapping**

Handle `resolve_media` as a cost-free internal operation, verify response bytes again in Python, and upload them through the existing production artifact boundary. During composition, map scene and narration references to their deterministic resolve-operation IDs, validate video/audio MIME types, write only digest-derived filenames, and pass bounded timing metadata to `compile_hyperframes_composition`.

- [ ] **Step 4: Verify executor GREEN and real local media behavior**

Run: `npm run test:agent -- agent/tests/test_production_executor.py agent/tests/test_production_media.py`

Then run strict HyperFrames validation and an ffmpeg/ffprobe narration-carve smoke fixture through the same compiled workspace path.

### Task 4: Full checkpoint verification and review

**Files:**
- Modify only documentation directly affected by the shipped behavior.

- [ ] **Step 1: Run all required checks**

Run `npm test`, `npm run test:agent`, lint, typecheck, `npm run build`, Firestore integration tests, HyperFrames strict validation, ffmpeg/ffprobe inspection, `git diff --check`, worker Docker build, and container runtime smoke.

- [ ] **Step 2: Review requirement and safety coverage**

Confirm the sealed plan changes when any source identity changes, production approval is invalidated by that change, resolve operations remain cost-free, duplicate deliveries reuse claims, and publication approval is untouched.

- [ ] **Step 3: Commit the coherent increment**

```bash
git add <explicit changed files>
git commit -m "feat: materialize verified production sources"
```

Do not add the unrelated untracked `pnpm-lock.yaml`; do not push or merge.
