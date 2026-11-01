# Operator Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the action-first, artifact-first, proof-on-demand Harmonia operator workspace.

**Architecture:** Add small presentation components around the existing persisted `JobFull` contract. Keep all durable workflow authority in the current APIs; local UI state controls only presentation, draft revision requests, and the proof drawer.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, Vitest server rendering.

**Spec:** `docs/superpowers/specs/2026-09-04-operator-workspace-design.md`

## Global Constraints

- Do not change workflow stages, approval semantics, receipts, or effect authority.
- Do not mutate accepted artifacts in place.
- Do not introduce mock data or simulated outcomes.
- Do not expose full internal identifiers or digests in primary operator views.

---

### Task 1: Action and return context

**Files:**
- Create: `src/components/studio/JobBriefCard.tsx`
- Create: `src/components/studio/SinceLastVisit.tsx`
- Modify: `src/components/studio/WorkingCanvas.tsx`
- Test: `tests/studioCanvas.test.ts`

**Interfaces:**
- Consumes: `JobFull`, `TimelineEvent[]`, and `operatorStatusForJob`.
- Produces: a saved-brief checkpoint and a job-scoped presentation-only return summary.

- [x] Write server-rendered and pure timestamp tests proving the brief and unseen-event summary.
- [x] Run the focused test and confirm it fails because the components do not exist.
- [x] Implement the two components and mount them below the operator status.
- [x] Run the focused test and confirm it passes.

### Task 2: Platform previews and governed revision

**Files:**
- Modify: `src/components/studio/WrittenWorkspace.tsx`
- Modify: `src/components/studio/WorkingCanvas.tsx`
- Test: `tests/studioCanvas.test.ts`

**Interfaces:**
- Consumes: `ContentArtifact`, `contentArtifactPreview`, and `(message: string) => void`.
- Produces: platform-shaped previews and an edited draft submitted as a grounded chat revision request.

- [x] Write a server-rendered test proving X and LinkedIn preview labels plus the revision control.
- [x] Run it and confirm it fails on the current generic artifact card.
- [x] Add preview framing, copy support, and a revision composer that calls the existing chat callback.
- [x] Run the focused test and confirm it passes.

### Task 3: Editorial schedule in the work layer

**Files:**
- Create: `src/components/studio/EditorialCalendar.tsx`
- Modify: `src/components/studio/WorkingCanvas.tsx`
- Test: `tests/studioEditorialCalendar.test.ts`

**Interfaces:**
- Consumes: `JobFull.editorialPlan` and `editorialItemStates`.
- Produces: a date-grouped, timezone-labelled schedule with selected-next and production states.

- [x] Write a calendar rendering test with two persisted items on different dates.
- [x] Run it and confirm it fails because the calendar component does not exist.
- [x] Implement date grouping and mount it under a Calendar canvas tab.
- [x] Run the focused test and confirm it passes.

### Task 4: Proof drawer and provenance cleanup

**Files:**
- Create: `src/components/studio/ProofDrawer.tsx`
- Modify: `src/components/studio/WorkingCanvas.tsx`
- Modify: `src/components/studio/SourcesWorkspace.tsx`
- Modify: `src/components/studio/ArtifactBoard.tsx`
- Modify: `src/components/studio/WrittenWorkspace.tsx`
- Test: `tests/studioCanvas.test.ts`

**Interfaces:**
- Consumes: `JobExecutionProof`, receipts, verifications, and timeline events.
- Produces: an accessible on-demand proof surface; primary cards retain human labels and counts.

- [x] Write tests proving the proof trigger, drawer label, and artifact-first hierarchy.
- [x] Run them and confirm they fail against the inline proof and raw provenance.
- [x] Implement the drawer, move the timeline, and collapse raw provenance in source views.
- [x] Run the focused tests and confirm they pass.

### Task 5: Accessibility and complete verification

**Files:**
- Modify: touched studio components and their tests.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: consistent readable labels, focus states, and verified production output.

- [x] Raise sub-12px interactive text in touched primary controls and add semantic labels/focus styles.
- [x] Run focused ESLint and `git diff --check`.
- [x] Run `./node_modules/.bin/vitest run` and require zero failures.
- [x] Run `npm run build` and require exit code zero.
