# Source Registry and Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are not permitted for this side-conversation execution.

**Goal:** Replace single-video jobs with durable mixed-source manifests, generalized extraction stages, typed provenance locators, and a working local mixed-source pipeline.

**Architecture:** Firestore stores bounded source records and manifest metadata; normalized payloads live in the artifact store. The Python worker executes provider-specific extractors behind one interface and writes extraction receipts through internal APIs. The stage machine becomes collect-sources then extract-sources before generalized understanding.

**Tech Stack:** TypeScript, Zod, Firestore, Pub/Sub, Python, Pydantic, FastAPI, BeautifulSoup, pypdf, python-docx, Gemini 3.5 Flash, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-08-30-multisource-content-operations-design.md`

## Global Constraints

- Delete `youtubeUrl`, `mediaAttachmentId`, `mediaFilename`, `mediaMime`, `mediaStorageUri`, and the brief-only shortcut.
- Delete `ingest` and `transcribe` stages; do not retain aliases.
- Enforce at most ten direct sources and at least one ready source before understanding.
- Preserve media-specific timestamps, frames, and clip materialization.
- Do not convert extraction failure into empty successful content.

---

### Task 1: Canonical source, locator, manifest, and stage contracts

**Files:**
- Modify: `src/lib/types.ts`
- Modify: `src/lib/contracts.ts`
- Modify: `src/components/jobTypes.ts`
- Modify: `agent/harmonia_agent/agent_models.py`
- Modify: `agent/harmonia_agent/activity_models.py`
- Test: `tests/sourceContracts.test.ts`
- Test: `agent/tests/test_source_models.py`

**Interfaces:**
- Produces: `SourceInput`, `SourceRecord`, `SourceState`, `EvidenceLocator`, `ContentSegment`, `NormalizedSource`, `JobSourceManifest`, `SourceFailure`, `SourceExclusionRecord`.
- Produces: stages `collect_sources`, `extract_sources`, and `awaiting_source_resolution`.
- Consumes: no legacy source fields.

- [ ] **Step 1: Write the failing TypeScript contract tests**

```ts
import { describe, expect, it } from "vitest";
import { createJobInputSchema, jobSourceManifestSchema, normalizedSourceSchema } from "@/lib/contracts";

it("accepts one library snapshot plus ten mixed direct sources", () => {
  const directSources = Array.from({ length: 10 }, (_, index) => ({
    kind: "pasted_text" as const,
    title: `Note ${index}`,
    text: "Grounded launch evidence",
    rightsAuthorizationId: `rights-${index}`,
  }));
  expect(createJobInputSchema.parse({ librarySnapshotId: "snapshot-1", directSources, desiredOutputs: ["x_post"] }).directSources).toHaveLength(10);
});

it("rejects eleven direct sources", () => {
  const directSources = Array.from({ length: 11 }, (_, index) => ({ kind: "pasted_text", title: `N${index}`, text: "Evidence", rightsAuthorizationId: `r-${index}` }));
  expect(() => createJobInputSchema.parse({ directSources, desiredOutputs: ["x_post"] })).toThrow();
});

it("requires typed locators on every normalized segment", () => {
  expect(() => normalizedSourceSchema.parse({ sourceId: "s1", sourceKind: "document", title: "Brief", mimeType: "application/pdf", contentDigest: "a".repeat(64), extractorVersion: "pdf-v1", extractedAt: new Date().toISOString(), extractionReceiptId: "r1", metadata: {}, segments: [{ id: "seg-1", text: "Claim", digest: "b".repeat(64) }] })).toThrow();
});
```

- [ ] **Step 2: Run the TypeScript tests and verify RED**

Run: `npm test -- tests/sourceContracts.test.ts`  
Expected: FAIL because the new schemas do not exist.

- [ ] **Step 3: Write the failing Python model tests**

```python
from pydantic import ValidationError
from harmonia_agent.agent_models import NormalizedSource, PageRangeLocator

def test_normalized_source_requires_locator_for_each_segment():
    try:
        NormalizedSource.model_validate({"sourceId": "s1", "sourceKind": "document", "title": "Brief", "mimeType": "application/pdf", "contentDigest": "a" * 64, "extractorVersion": "pdf-v1", "extractedAt": "2026-08-30T00:00:00Z", "extractionReceiptId": "r1", "metadata": {}, "segments": [{"id": "seg-1", "text": "Claim", "digest": "b" * 64}]})
    except ValidationError:
        return
    raise AssertionError("segment without locator was accepted")

def test_page_locator_is_one_based_and_increasing():
    locator = PageRangeLocator(kind="page_range", startPage=1, endPage=2)
    assert locator.endPage == 2
```

- [ ] **Step 4: Run the Python tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_source_models.py -q`  
Expected: FAIL because the models do not exist.

- [ ] **Step 5: Implement the strict TypeScript and Pydantic unions**

Replace `JobConfig` with `sourceManifestId`, `desiredOutputs`, `allowedOutputs`, strategy context, research request, and platforms. Define identical locator discriminators in both languages. Replace `STAGES` and all stage enums without legacy aliases.

- [ ] **Step 6: Run targeted contract tests and the type checker**

Run: `npm test -- tests/sourceContracts.test.ts && npx tsc --noEmit && cd agent && ./.venv/bin/python -m pytest tests/test_source_models.py -q`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/types.ts src/lib/contracts.ts src/components/jobTypes.ts tests/sourceContracts.test.ts agent/harmonia_agent/agent_models.py agent/harmonia_agent/activity_models.py agent/tests/test_source_models.py
git commit -m "feat: replace jobs with multisource contracts"
```

### Task 2: Firestore source registry and immutable manifests

**Files:**
- Create: `src/lib/sourceRegistry.ts`
- Create: `src/lib/sourceManifest.ts`
- Modify: `src/lib/firestore.ts`
- Modify: `firestore.indexes.json`
- Test: `tests/sourceRegistry.test.ts`
- Test: `tests/sourceRegistryFirestore.integration.test.ts`

**Interfaces:**
- Produces: `createSourceRecords(scope, inputs)`, `transitionSourceState(...)`, `sealSourceManifest(...)`, `reviseManifestAfterResolution(...)`, `listManifestSources(...)`.
- Consumes: Task 1 source contracts.

- [ ] **Step 1: Write failing pure state tests**

```ts
it("does not move a ready source back to extracting", () => {
  expect(() => transitionSource({ ...readySource, state: "ready" }, "extracting", 4)).toThrow("invalid source transition");
});

it("seals a canonical manifest digest independent of input order", () => {
  expect(manifestDigest(inputWithSources("a", "b"))).toBe(manifestDigest(inputWithSources("b", "a")));
});
```

- [ ] **Step 2: Run pure tests and verify RED**

Run: `npm test -- tests/sourceRegistry.test.ts`  
Expected: FAIL because registry functions do not exist.

- [ ] **Step 3: Implement source transition and manifest digest helpers**

Use explicit transition tables. Canonicalize sorted source IDs, snapshot ID, exclusions, revision, and job ID before SHA-256 hashing.

- [ ] **Step 4: Run pure tests and verify GREEN**

Run: `npm test -- tests/sourceRegistry.test.ts`  
Expected: PASS.

- [ ] **Step 5: Write failing Firestore transaction tests**

Test concurrent state transitions, manifest revision conflicts, cross-tenant reads, zero-ready-source rejection, and immutable sealed manifests.

- [ ] **Step 6: Run the integration test and verify RED**

Run: `npm run test:integration`  
Expected: FAIL because persistence functions do not exist.

- [ ] **Step 7: Implement Firestore persistence and indexes**

Store sources at `workspaces/{workspaceId}/brands/{brandId}/sources/{sourceId}` and manifests under each job. Use transactions for revision checks. Store large normalized payloads by artifact ID only.

- [ ] **Step 8: Run source registry suites and verify GREEN**

Run: `npm test -- tests/sourceRegistry.test.ts && npm run test:integration`  
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/sourceRegistry.ts src/lib/sourceManifest.ts src/lib/firestore.ts firestore.indexes.json tests/sourceRegistry.test.ts tests/sourceRegistryFirestore.integration.test.ts
git commit -m "feat: add durable source registry"
```

### Task 3: Replace job creation with source-manifest creation

**Files:**
- Modify: `src/app/api/jobs/route.ts`
- Modify: `src/lib/chatIntent.ts`
- Modify: `src/lib/chatHandler.ts`
- Modify: `src/lib/chatAttachments.ts`
- Modify: `src/lib/sourceRights.ts`
- Test: `tests/jobSourceCreation.test.ts`
- Test: `tests/chatIntent.test.ts`
- Test: `tests/chatAttachments.test.ts`

**Interfaces:**
- Produces: `POST /api/jobs` accepting `{librarySnapshotId?, directSources, desiredOutputs, allowedOutputs, strategyContext?, analysisResearchRequest?}`.
- Produces: chat intent source descriptors rather than `youtubeUrl` or `topic` shortcuts.

- [ ] **Step 1: Write failing route tests**

Test mixed YouTube/web/upload/pasted-text creation, empty input rejection without library, eleven-source rejection, attachment tenancy, rights requirements, desired-output validation, and initial `collect_sources` trigger.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/jobSourceCreation.test.ts tests/chatIntent.test.ts tests/chatAttachments.test.ts`  
Expected: FAIL on the legacy request shape.

- [ ] **Step 3: Replace route, chat intent, attachment, and rights contracts**

Delete branches for `youtubeUrl` and `brief`. Create source records, seal the initial manifest, append a bounded event, and queue `collect_sources`.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `npm test -- tests/jobSourceCreation.test.ts tests/chatIntent.test.ts tests/chatAttachments.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/api/jobs/route.ts src/lib/chatIntent.ts src/lib/chatHandler.ts src/lib/chatAttachments.ts src/lib/sourceRights.ts tests/jobSourceCreation.test.ts tests/chatIntent.test.ts tests/chatAttachments.test.ts
git commit -m "feat: create jobs from source manifests"
```

### Task 4: Provider-neutral extraction framework and document/web extractors

**Files:**
- Create: `agent/harmonia_agent/extraction/__init__.py`
- Create: `agent/harmonia_agent/extraction/base.py`
- Create: `agent/harmonia_agent/extraction/text.py`
- Create: `agent/harmonia_agent/extraction/documents.py`
- Create: `agent/harmonia_agent/extraction/web.py`
- Create: `agent/harmonia_agent/extraction/security.py`
- Modify: `agent/requirements.txt`
- Modify: `agent/requirements.lock`
- Test: `agent/tests/test_text_extraction.py`
- Test: `agent/tests/test_document_extraction.py`
- Test: `agent/tests/test_web_extraction.py`

**Interfaces:**
- Produces: `SourceExtractor`, `ExtractionContext`, `ExtractionEstimate`, `ExtractionResult`, `extractor_for(source)`.
- Consumes: normalized source models from Task 1.

- [ ] **Step 1: Write failing text and Markdown extraction tests**

Assert stable paragraph/line locators, heading occurrences, Unicode preservation, empty-content rejection, and deterministic segment digests.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_text_extraction.py -q`  
Expected: FAIL because extractors do not exist.

- [ ] **Step 3: Implement text and Markdown extraction**

Produce bounded segments with one-based line and paragraph locators. Reject whitespace-only inputs.

- [ ] **Step 4: Write failing PDF and DOCX extraction tests**

Create minimal in-memory fixtures and assert PDF page ranges, DOCX headings/paragraphs/tables/lists, password-protected PDF failure, and extractor version metadata.

- [ ] **Step 5: Add real parsing dependencies and implement document extraction**

Add `pypdf>=6,<7` and `python-docx>=1.2,<2`; regenerate `requirements.lock` through the repository's dependency-lock process. Do not hand-edit resolved transitive versions.

- [ ] **Step 6: Write failing web security tests**

Assert rejection of localhost, loopback IPv6, RFC1918, link-local, metadata-service addresses, DNS rebinding between redirects, unsupported MIME, excess redirects, excess bytes, and executable content. Assert canonical URL and heading/text locators for a valid public HTML fixture.

- [ ] **Step 7: Implement web policy and extraction**

Resolve and validate every destination before each request. Stream with a byte ceiling. Parse only supported textual MIME types. Retain `public_untrusted` trust classification.

- [ ] **Step 8: Run all extractor tests and verify GREEN**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_text_extraction.py tests/test_document_extraction.py tests/test_web_extraction.py -q`  
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add agent/harmonia_agent/extraction agent/requirements.txt agent/requirements.lock agent/tests/test_text_extraction.py agent/tests/test_document_extraction.py agent/tests/test_web_extraction.py
git commit -m "feat: extract documents text and web sources"
```

### Task 5: Generalize media extraction without losing YouTube/video capabilities

**Files:**
- Create: `agent/harmonia_agent/extraction/media.py`
- Modify: `agent/harmonia_agent/content.py`
- Modify: `agent/harmonia_agent/youtube.py`
- Modify: `agent/harmonia_agent/clipper.py`
- Test: `agent/tests/test_media_extraction.py`
- Modify: `agent/tests/test_cost_reporting.py`

**Interfaces:**
- Produces: `MediaExtractor.extract()` returning transcript segments, time locators, frame locators, metadata, and a materialized source artifact reference.
- Consumes: existing real Gemini transcription, YouTube metadata, upload retrieval, and clip materialization code.

- [ ] **Step 1: Write failing media extraction tests**

Cover YouTube metadata, uploaded audio, uploaded video, transcript timestamps, frame references, media digest, duration limits, failed download, and clip materialization from the original source artifact.

- [ ] **Step 2: Run tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_media_extraction.py -q`  
Expected: FAIL because `MediaExtractor` does not exist.

- [ ] **Step 3: Move media behavior behind `MediaExtractor`**

Reuse provider clients but remove job-field reads. The extractor receives one `SourceRecord` and an authorized retrieval callback. Preserve real Gemini usage accounting.

- [ ] **Step 4: Run media and cost tests and verify GREEN**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_media_extraction.py tests/test_cost_reporting.py -q`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/extraction/media.py agent/harmonia_agent/content.py agent/harmonia_agent/youtube.py agent/harmonia_agent/clipper.py agent/tests/test_media_extraction.py agent/tests/test_cost_reporting.py
git commit -m "feat: preserve media in generalized extraction"
```

### Task 6: Source internal APIs and generalized collect/extract stages

**Files:**
- Create: `src/app/api/internal/sources/[id]/route.ts`
- Create: `src/app/api/internal/source-manifest/route.ts`
- Create: `src/app/api/jobs/[id]/sources/resolve/route.ts`
- Delete: `src/app/api/internal/ingest/route.ts`
- Delete: `src/app/api/internal/transcript/route.ts`
- Modify: `agent/harmonia_agent/web_client.py`
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `agent/harmonia_agent/main.py`
- Modify: `src/lib/advance.ts`
- Modify: `src/lib/stageTrigger.ts`
- Test: `tests/sourceRoutes.test.ts`
- Test: `agent/tests/test_source_stages.py`

**Interfaces:**
- Produces: scoped read/update APIs for source work, extraction receipts, normalized artifacts, manifest reads, and resolution actions.
- Produces: `run_collect_sources(job_id)` and `run_extract_sources(job_id)`.

- [ ] **Step 1: Write failing internal route authority tests**

Assert tenant scope, internal bearer authentication, source revision matching, digest validation, immutable extraction receipts, and invalid resolution rejection.

- [ ] **Step 2: Run route tests and verify RED**

Run: `npm test -- tests/sourceRoutes.test.ts`  
Expected: FAIL because routes do not exist.

- [ ] **Step 3: Implement internal source and manifest routes**

Keep request and response bodies bounded. Store normalized bytes through the artifact route and only artifact references in source records.

- [ ] **Step 4: Write failing Python stage tests**

Assert collection validates every source; extraction processes ready work independently; one failure produces `awaiting_source_resolution`; all-ready advances to `understand`; Continue seals a new manifest; duplicate delivery reuses completed extraction.

- [ ] **Step 5: Run stage tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_source_stages.py -q`  
Expected: FAIL because stages do not exist.

- [ ] **Step 6: Implement collect/extract stages and delete legacy stage handlers**

Remove `run_ingest`, `run_transcribe`, `_AUDIO_CACHE`, and job-level media branching. Dispatch by source record and extractor. Preserve typed provider errors and operation IDs.

- [ ] **Step 7: Run route and stage tests and verify GREEN**

Run: `npm test -- tests/sourceRoutes.test.ts && cd agent && ./.venv/bin/python -m pytest tests/test_source_stages.py -q`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add -A src/app/api/internal src/app/api/jobs src/lib/advance.ts src/lib/stageTrigger.ts agent/harmonia_agent/web_client.py agent/harmonia_agent/stages.py agent/harmonia_agent/main.py tests/sourceRoutes.test.ts agent/tests/test_source_stages.py
git commit -m "feat: run generalized source stages"
```

### Task 7: Generalize Nimi, downstream evidence, and mixed-source integration

**Files:**
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/nimi_prompt.py`
- Modify: `agent/harmonia_agent/nimi_skills.py`
- Modify: `agent/harmonia_agent/evaluation_contracts.py`
- Modify: `src/lib/a2ui/presentationContext.ts`
- Modify: `src/lib/a2ui/hydrateSurfacePlan.ts`
- Test: `agent/tests/test_nimi_multisource.py`
- Test: `agent/tests/test_agent_team.py`
- Test: `tests/mixedSourceWorkflowFirestore.integration.test.ts`

**Interfaces:**
- Produces: one bounded multi-source analysis package whose claims reference source ID, segment ID, and typed locator.
- Consumes: sealed source manifest and normalized artifact previews.

- [ ] **Step 1: Write failing Nimi multisource tests**

Assert cross-modal analysis accepts video, PDF, webpage, and pasted text; rejects missing segments, cross-source locator substitution, invented timestamps for documents, and unsupported clip candidates without video evidence.

- [ ] **Step 2: Run agent tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_nimi_multisource.py tests/test_agent_team.py -q`  
Expected: FAIL on single-source assumptions.

- [ ] **Step 3: Replace source-package prompts and validators**

Give Nimi bounded previews plus artifact references. Require modality-aware locators on every evidence-bearing output. Keep deterministic validation outside the model.

- [ ] **Step 4: Write failing mixed-source integration test**

Use real local extraction code with a TXT fixture, Markdown fixture, generated PDF fixture, and a recorded authorized media fixture. Assert manifest seal, extraction, source resolution-free progression, generalized analysis persistence, and no legacy job fields.

- [ ] **Step 5: Run integration test and verify RED**

Run: `npm run test:integration`  
Expected: FAIL until all web/agent boundaries are connected.

- [ ] **Step 6: Connect downstream evidence and A2UI context**

Replace video-only source summaries with typed source summaries and exact locators. Do not yet redesign the Studio UI; expose correct data for Plan 4.

- [ ] **Step 7: Run targeted suites and verify GREEN**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_nimi_multisource.py tests/test_agent_team.py -q && cd .. && npm run test:integration`  
Expected: PASS.

- [ ] **Step 8: Remove obsolete tests and fixtures, then run full verification**

Delete tests that assert legacy fields or stages; replace their behavior coverage using new manifests. Run: `npm test && npm run test:integration && npx tsc --noEmit && npm run lint && npm run build && npm run test:agent`  
Expected: all commands PASS with no legacy compatibility layer.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: complete mixed source workflow"
```
