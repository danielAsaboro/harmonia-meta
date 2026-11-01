# Studio and Multimodal Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Subagents are not permitted for this side-conversation execution.

**Goal:** Complete the multisource experience inside Harmonia's current Studio and let the approved strategy produce grounded text, image, calendar, pack, clip, reel, and separately approved generative-media outputs.

**Architecture:** The existing conversation/canvas Studio remains the shell. The composer creates source manifests and selects one healthy brand-library snapshot. The Sources canvas becomes the manifest/extraction/provenance command center. Output intent is captured in the job, proposed by strategy, confirmed by the operator, and compiled into typed artifact actions with existing policy, idempotency, receipts, and verification.

**Tech Stack:** React 19, Next.js 16, A2UI, TypeScript, Zod, Google ADK, Gemini 3.5 Flash, existing effect pipeline, ffmpeg, Vitest, pytest.

**Spec:** `docs/superpowers/specs/2026-08-30-multisource-content-operations-design.md`

## Global Constraints

- Preserve the current Studio split layout, mobile pane switcher, palette, typography, approval dock, and host-owned authority controls.
- The user declares desired and allowed outputs; Harmonia recommends the final mix for strategy approval.
- Text and image outputs do not require video.
- Clips and reels require real time-range evidence; generative video is never mislabeled as a source clip.
- Generated A2UI surfaces may present data but never own source resolution, steering, approval, or publication controls.

---

### Task 1: Output intent, plan, and modality eligibility contracts

**Files:**
- Create: `src/lib/outputPlanning.ts`
- Modify: `src/lib/types.ts`
- Modify: `src/lib/contracts.ts`
- Modify: `agent/harmonia_agent/agent_models.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/ryan_prompt.py`
- Test: `tests/outputPlanning.test.ts`
- Test: `agent/tests/test_output_planning.py`

**Interfaces:**
- Produces: `OutputType`, `OutputIntent`, `ProposedOutput`, `CampaignOutputPlan`, `validateOutputEligibility(plan, manifest)`.
- Consumes: normalized manifest modality summary and configured channel capabilities.

- [ ] **Step 1: Write failing TypeScript eligibility tests**

```ts
it("allows text and image outputs from document-only evidence", () => {
  expect(validateOutputEligibility(plan(["x_post", "linkedin_post", "social_image"]), documentManifest())).toEqual([]);
});

it("rejects a source clip without video time-range evidence", () => {
  expect(validateOutputEligibility(plan(["short_clip"]), documentManifest())).toContainEqual(expect.objectContaining({ code: "video_evidence_required" }));
});

it("keeps generated video distinct from a source clip", () => {
  expect(outputTypeSchema.parse("generated_video")).toBe("generated_video");
  expect(outputTypeSchema.parse("short_clip")).toBe("short_clip");
});
```

- [ ] **Step 2: Run TypeScript tests and verify RED**

Run: `npm test -- tests/outputPlanning.test.ts`  
Expected: FAIL because output planning does not exist.

- [ ] **Step 3: Write failing Ryan output-plan tests**

Assert desired/allowed intersection, evidence references, quantities, destinations, cost class, approval class, unsupported-channel disclosure, and no clip from non-video manifests.

- [ ] **Step 4: Run Python tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_output_planning.py -q`  
Expected: FAIL because agent models and prompts do not expose the plan.

- [ ] **Step 5: Implement contracts, deterministic eligibility, and Ryan proposal schema**

Output types: `x_post`, `x_thread`, `linkedin_post`, `blog_article`, `newsletter`, `caption`, `carousel_spec`, `social_image`, `quote_card`, `diagram`, `short_clip`, `reel`, `generated_video`, `generated_music`, `editorial_calendar`, and `content_pack`.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run: `npm test -- tests/outputPlanning.test.ts && cd agent && ./.venv/bin/python -m pytest tests/test_output_planning.py -q`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/outputPlanning.ts src/lib/types.ts src/lib/contracts.ts agent/harmonia_agent/agent_models.py agent/harmonia_agent/agents.py agent/harmonia_agent/ryan_prompt.py tests/outputPlanning.test.ts agent/tests/test_output_planning.py
git commit -m "feat: add hybrid multimodal output planning"
```

### Task 2: Grounded text, image, and specification artifact producers

**Files:**
- Create: `agent/harmonia_agent/output_producers.py`
- Modify: `agent/harmonia_agent/agent_models.py`
- Modify: `agent/harmonia_agent/agents.py`
- Modify: `agent/harmonia_agent/noni_prompt.py`
- Modify: `agent/harmonia_agent/dara_prompt.py`
- Modify: `agent/harmonia_agent/generative_media.py`
- Modify: `src/lib/types.ts`
- Test: `agent/tests/test_output_producers.py`
- Test: `agent/tests/test_noni_contracts.py`
- Test: `agent/tests/test_dara_contracts.py`

**Interfaces:**
- Produces: `produce_grounded_artifact(request: OutputArtifactRequest) -> OutputArtifactResult`.
- Produces typed content for X posts/threads, LinkedIn posts, blog articles, newsletters, captions, carousel specifications, quote cards, diagrams, and social-image briefs.
- Consumes: one approved output-plan item and its exact normalized evidence references.

- [ ] **Step 1: Write failing producer tests**

```python
def test_document_only_campaign_produces_linkedin_article_and_image_brief():
    results = produce_fixture_outputs(
        requested=["linkedin_post", "blog_article", "social_image"],
        evidence=document_evidence(),
    )
    assert [result.outputType for result in results] == ["linkedin_post", "blog_article", "social_image"]
    assert all(result.evidenceRefs for result in results)

def test_clip_request_is_rejected_without_time_range_evidence():
    with pytest.raises(OutputEligibilityError, match="video evidence"):
        produce_fixture_outputs(requested=["short_clip"], evidence=document_evidence())
```

- [ ] **Step 2: Run producer tests and verify RED**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_output_producers.py tests/test_noni_contracts.py tests/test_dara_contracts.py -q`  
Expected: FAIL because Noni is limited to X text posts and no generalized producer exists.

- [ ] **Step 3: Implement typed producer dispatch**

```python
PRODUCERS: dict[str, Callable[[OutputArtifactRequest], Awaitable[OutputArtifactResult]]] = {
    "x_post": produce_short_form_text,
    "x_thread": produce_short_form_text,
    "linkedin_post": produce_short_form_text,
    "blog_article": produce_long_form_text,
    "newsletter": produce_long_form_text,
    "caption": produce_short_form_text,
    "carousel_spec": produce_visual_spec,
    "quote_card": produce_visual_spec,
    "diagram": produce_visual_spec,
    "social_image": produce_image_brief,
}
```

Each result contains strict structured content, evidence references, constraint references, assumptions, confidence, and review status. Dara uses format-specific deterministic constraints and remains unable to invent evidence or authorize effects. Image briefs feed the existing real image-generation adapter only when the output plan permits generation.

- [ ] **Step 4: Run producer and editorial tests and verify GREEN**

Run: `cd agent && ./.venv/bin/python -m pytest tests/test_output_producers.py tests/test_noni_contracts.py tests/test_dara_contracts.py -q`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/output_producers.py agent/harmonia_agent/agent_models.py agent/harmonia_agent/agents.py agent/harmonia_agent/noni_prompt.py agent/harmonia_agent/dara_prompt.py agent/harmonia_agent/generative_media.py src/lib/types.ts agent/tests/test_output_producers.py agent/tests/test_noni_contracts.py agent/tests/test_dara_contracts.py
git commit -m "feat: produce grounded multimodal artifacts"
```

### Task 3: Source-aware artifact action compiler

**Files:**
- Create: `src/lib/outputActions.ts`
- Modify: `src/lib/policy.ts`
- Modify: `src/lib/jobEffectCommands.ts`
- Modify: `src/lib/publishing/contracts.ts`
- Modify: `agent/harmonia_agent/generative_media.py`
- Modify: `agent/harmonia_agent/clipper.py`
- Test: `tests/outputActions.test.ts`
- Test: `tests/publishingApproval.test.ts`
- Test: `agent/tests/test_output_actions.py`

**Interfaces:**
- Produces: `compileOutputActions(job, approvedOutputPlan)` creating typed planned actions with exact evidence, cost, destination, and approval policy.
- Consumes: existing idempotency, claim, effect, receipt, and verification pipeline.

- [ ] **Step 1: Write failing action compiler tests**

Assert text drafts, image requests, carousel specs, articles, calendars, packs, clips, reels, generated b-roll/audio, unsupported destinations, exact evidence lineage, and stable action IDs.

- [ ] **Step 2: Run TypeScript tests and verify RED**

Run: `npm test -- tests/outputActions.test.ts tests/publishingApproval.test.ts`  
Expected: FAIL because compiler and new action types do not exist.

- [ ] **Step 3: Implement compiler and policy mapping**

Publishing and paid generation require approval. Safe local text/artifact assembly may run after strategy approval. Clip/reel actions require eligible video references. Every effect payload digest includes the output-plan digest and source lineage.

- [ ] **Step 4: Write failing Python execution tests**

Assert clip extraction from real source artifact, reel assembly, generated media distinction, cost reservation, result artifact metadata, and no fake success on provider failure.

- [ ] **Step 5: Implement Python action execution changes**

Reuse existing real ffmpeg and provider adapters. Do not introduce placeholder renderers for new types; unsupported provider-backed outputs remain planned but non-executable and visibly blocked until a real adapter exists.

- [ ] **Step 6: Run targeted tests and verify GREEN**

Run: `npm test -- tests/outputActions.test.ts tests/publishingApproval.test.ts && cd agent && ./.venv/bin/python -m pytest tests/test_output_actions.py -q`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/outputActions.ts src/lib/policy.ts src/lib/jobEffectCommands.ts src/lib/publishing/contracts.ts agent/harmonia_agent/generative_media.py agent/harmonia_agent/clipper.py tests/outputActions.test.ts tests/publishingApproval.test.ts agent/tests/test_output_actions.py
git commit -m "feat: compile source aware output actions"
```

### Task 4: Studio composer source and output controls

**Files:**
- Modify: `src/components/studio/StudioComposer.tsx`
- Modify: `src/components/a2ui/AttachmentComposer.tsx`
- Create: `src/components/studio/BrandLibrarySelector.tsx`
- Create: `src/components/studio/DirectSourceComposer.tsx`
- Create: `src/components/studio/OutputIntentSelector.tsx`
- Modify: `src/components/ChatConsole.tsx`
- Modify: `src/hooks/useHarmoniaChat.ts`
- Test: `tests/studioSourceComposer.test.tsx`
- Test: `tests/studioOutputIntent.test.tsx`

**Interfaces:**
- Produces: current Studio composer controls for zero/one library snapshot, up to ten direct inputs, pasted text, recognized URLs, desired outputs, and cost/start request.

- [ ] **Step 1: Write failing composer tests**

Assert mixed uploads/URLs/text, exact ten-source cap, library snapshot selection, no-source rejection, attachment progress, duplicate detection, desired-output selection, mobile reachability, and current Harmonia visual structure.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/studioSourceComposer.test.tsx tests/studioOutputIntent.test.tsx`  
Expected: FAIL because controls do not exist.

- [ ] **Step 3: Implement controls in the existing composer**

Do not create a separate full-page job wizard. Preserve normal conversational job creation and show source pills, selected library snapshot, and output intent in the composer working set.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `npm test -- tests/studioSourceComposer.test.tsx tests/studioOutputIntent.test.tsx`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/studio src/components/a2ui/AttachmentComposer.tsx src/components/ChatConsole.tsx src/hooks/useHarmoniaChat.ts tests/studioSourceComposer.test.tsx tests/studioOutputIntent.test.tsx
git commit -m "feat: add multisource Studio composer"
```

### Task 5: Replace transcript-only Sources workspace

**Files:**
- Replace: `src/components/studio/SourcesWorkspace.tsx`
- Create: `src/components/studio/SourceManifestPanel.tsx`
- Create: `src/components/studio/SourceResolutionPanel.tsx`
- Create: `src/components/studio/NormalizedSourceViewer.tsx`
- Modify: `src/lib/studio/workspaceModel.ts`
- Modify: `src/components/studio/WorkingCanvas.tsx`
- Test: `tests/studioSourcesWorkspace.test.tsx`
- Test: `tests/studioWorkspaceModel.test.ts`

**Interfaces:**
- Produces: manifest/snapshot summary, per-source extraction state, Retry/Replace/Remove/Reconnect/Continue, modality-aware content viewer, typed locator display, and provenance navigation.

- [ ] **Step 1: Write failing Sources workspace tests**

Assert library snapshot and direct inputs, PDF pages, DOCX sections, web URL fragments, text lines, media timestamps/frames, failed-source pause, exclusion receipt, source counts, and responsive rendering.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/studioSourcesWorkspace.test.tsx tests/studioWorkspaceModel.test.ts`  
Expected: FAIL on transcript-only model.

- [ ] **Step 3: Replace the workspace with generalized source components**

Keep strategy, editorial plan, production trace, receipts, and verification in their existing views; the Sources tab owns source truth and resolution only.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `npm test -- tests/studioSourcesWorkspace.test.tsx tests/studioWorkspaceModel.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/studio src/lib/studio/workspaceModel.ts tests/studioSourcesWorkspace.test.tsx tests/studioWorkspaceModel.test.ts
git commit -m "feat: generalize the Studio Sources workspace"
```

### Task 6: A2UI, chat, Telegram, and output-plan approval presentation

**Files:**
- Modify: `agent/harmonia_agent/a2ui_models.py`
- Modify: `agent/harmonia_agent/a2ui_presenter.py`
- Modify: `src/components/a2ui/HarmoniaCatalog.tsx`
- Modify: `src/lib/a2ui/presentationContext.ts`
- Modify: `src/lib/a2ui/hydrateSurfacePlan.ts`
- Modify: `src/lib/chatIntent.ts`
- Modify: `src/lib/chatHandler.ts`
- Modify: `src/lib/telegramWebhook.ts`
- Modify: `agent/harmonia_agent/telegram_bot.py`
- Test: `tests/a2uiMultisource.test.ts`
- Test: `agent/tests/test_a2ui_multisource.py`
- Test: `tests/chatMultisource.test.ts`
- Test: `tests/telegramMultisource.test.ts`

**Interfaces:**
- Produces: reference-only source manifest, normalized evidence, output plan, and artifact presentation nodes.
- Produces: chat/Telegram grammar for existing-library selection, mixed public URLs/text, output intent, and source-resolution status.

- [ ] **Step 1: Write failing A2UI and surface-routing tests**

Assert exact catalog binding, no model-authored source resolution or output approval controls, Telegram existing-library selection by name, web-only connection establishment, and protected output-plan approval.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/a2uiMultisource.test.ts tests/chatMultisource.test.ts tests/telegramMultisource.test.ts && cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_multisource.py -q`  
Expected: FAIL on video-only presentation contracts.

- [ ] **Step 3: Implement generalized presentation and routing**

Hydrate all source truth from persisted records. Agent output contains layout and references only. Keep decisions in host controls.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `npm test -- tests/a2uiMultisource.test.ts tests/chatMultisource.test.ts tests/telegramMultisource.test.ts && cd agent && ./.venv/bin/python -m pytest tests/test_a2ui_multisource.py -q`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/a2ui_models.py agent/harmonia_agent/a2ui_presenter.py src/components/a2ui/HarmoniaCatalog.tsx src/lib/a2ui src/lib/chatIntent.ts src/lib/chatHandler.ts src/lib/telegramWebhook.ts agent/harmonia_agent/telegram_bot.py tests/a2uiMultisource.test.ts agent/tests/test_a2ui_multisource.py tests/chatMultisource.test.ts tests/telegramMultisource.test.ts
git commit -m "feat: present multisource campaigns across surfaces"
```

### Task 7: Monitoring, evidence, architecture, and documentation truth

**Files:**
- Modify: `agent/harmonia_agent/activity_projection.py`
- Modify: `src/components/monitoring/WorkflowActivityView.tsx`
- Modify: `src/lib/verticalSliceEvidence.ts`
- Modify: `scripts/verify-vertical-slice-evidence.ts`
- Modify: `README.md`
- Modify: `docs/architecture.mdx`
- Modify: `docs/pipeline.mdx`
- Modify: `docs/configuration.mdx`
- Modify: `docs/evidence-runbook.mdx`
- Modify: `src/lib/architecture/data.ts`
- Modify: `src/components/landing/workflow.ts`
- Modify: `src/components/landing/WorkflowMorph.tsx`
- Test: `tests/multisourceMonitoring.test.ts`
- Test: `tests/multisourceEvidence.test.ts`
- Test: `tests/documentationTruth.test.ts`
- Test: `tests/architectureData.test.ts`
- Test: `tests/landingWorkflow.test.ts`

**Interfaces:**
- Produces: metadata-only monitoring and evidence correlation for manifest, snapshot, source extraction, output plan, steering, approvals, effects, and verification.

- [ ] **Step 1: Write failing monitoring/evidence/docs tests**

Assert new stage names, manifest and snapshot IDs, extraction receipts, output-plan digest, source resolution, nudge invalidation, no transcript-only architecture, and explicit authenticated-proof boundaries.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/multisourceMonitoring.test.ts tests/multisourceEvidence.test.ts tests/documentationTruth.test.ts tests/architectureData.test.ts tests/landingWorkflow.test.ts`  
Expected: FAIL on legacy workflow copy and evidence schema.

- [ ] **Step 3: Update monitoring, verifier, public docs, and architecture data**

Describe supported code separately from authenticated live proof. Retain YouTube in the demo path while positioning it as one source type.

- [ ] **Step 4: Run targeted tests and verify GREEN**

Run: `npm test -- tests/multisourceMonitoring.test.ts tests/multisourceEvidence.test.ts tests/documentationTruth.test.ts tests/architectureData.test.ts tests/landingWorkflow.test.ts`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/harmonia_agent/activity_projection.py src/components/monitoring/WorkflowActivityView.tsx src/lib/verticalSliceEvidence.ts scripts/verify-vertical-slice-evidence.ts README.md docs src/lib/architecture/data.ts src/components/landing tests
git commit -m "docs: align Harmonia with multisource operations"
```

### Task 8: Full-system verification and obsolete-contract deletion audit

**Files:**
- Modify or delete: every remaining file found by the legacy scans below
- Test: all TypeScript, integration, Python, build, lint, docs, and evidence suites

**Interfaces:**
- Produces: one contract with no legacy job fields, stages, routes, or UI assumptions.

- [ ] **Step 1: Run legacy scans and require zero matches in active implementation**

Run:

```bash
rg -n 'youtubeUrl|mediaAttachmentId|mediaStorageUri|run_ingest|run_transcribe|"ingest"|"transcribe"' src agent/harmonia_agent tests agent/tests
```

Expected: no active contract, stage, route, or fixture matches. Provider-specific YouTube adapter names and prose describing supported YouTube extraction may remain only where they do not encode the deleted job shape or stages.

- [ ] **Step 2: Delete or replace every obsolete match**

Do not add aliases, readers, adapters, migrations, dual writes, or fallback stage handling.

- [ ] **Step 3: Run complete verification**

Run:

```bash
npm test
npm run test:integration
npx tsc --noEmit
npm run lint
npm run build
npm run test:agent
npm run verify:evidence -- --help
git diff --check
```

Expected: every command exits 0; tests emit no unexpected warnings; evidence verifier retains fail-closed behavior.

- [ ] **Step 4: Run a real local mixed-source workflow**

Use one authorized YouTube source, one PDF, one public webpage, one pasted text source, and one local synchronized-library fixture. Confirm source extraction, strategy/output-plan approval, text and image artifact planning, a real ffmpeg clip, a nudge invalidation, an idempotent content-pack effect, and digest verification. Record it as local contract evidence only.

- [ ] **Step 5: Review the diff against the approved spec**

Check every acceptance criterion in `docs/superpowers/specs/2026-08-30-multisource-content-operations-design.md`. Record any authenticated-provider or deployment proof still missing in the private parent evidence ledger.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: complete multisource content operations"
```
