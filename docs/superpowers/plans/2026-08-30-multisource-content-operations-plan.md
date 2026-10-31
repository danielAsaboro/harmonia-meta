# Multisource Content Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement these plans task-by-task. Subagents are not permitted for this side-conversation execution.

**Goal:** Replace Harmonia's single-video job model with mixed source bundles, synchronized brand libraries, multimodal output planning, and durable operator steering integrated into the existing Studio.

**Architecture:** Execute four ordered plans. The source registry and generalized extraction contract land first; brand libraries build on that registry; durable steering builds on the new job lineage; Studio and multimodal output integration complete the operator experience and remove all remaining video-first presentation contracts.

**Tech Stack:** Next.js 16, TypeScript 5, React 19, Zod 4, Firestore, Pub/Sub, Cloud Scheduler, Google Cloud Storage, Google Drive API/Picker, Python 3.12, FastAPI, Pydantic 2, Google ADK 2.7, Gemini 3.5 Flash, pytest, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-multisource-content-operations-design.md`

## Global Constraints

- Do not preserve backward compatibility; remove obsolete contracts, stages, routes, fixtures, and fallbacks.
- A job references zero or one immutable brand-library snapshot and zero to ten direct sources; without a library it requires at least one direct source.
- YouTube, uploaded video, uploaded audio, PDF, DOCX, TXT, Markdown, public web, and pasted text are the supported direct inputs.
- Google Drive folders and GCS bucket prefixes are selected through authenticated UI controls, never pasted as storage paths.
- Every claim references a source ID, segment ID, and typed locator.
- Partial extraction failure pauses before understanding and requires Retry, Replace, Remove, Reconnect, or Continue.
- External publication, destructive steering, paid generation, and material effects remain approval-gated.
- Tests and local fixtures never count as authenticated provider or cloud evidence.

## Ordered Plans

1. [`2026-08-30-source-registry-and-extraction-plan.md`](./2026-08-30-source-registry-and-extraction-plan.md)  
   Replaces job inputs and stage contracts; adds source persistence, manifests, extractors, generalized evidence, and a mixed-source local workflow.
2. [`2026-08-30-brand-library-sync-plan.md`](./2026-08-30-brand-library-sync-plan.md)  
   Adds Drive/GCS folder selection, incremental scheduled sync, immutable snapshots, connection policy, and Settings controls.
3. [`2026-08-30-durable-steering-plan.md`](./2026-08-30-durable-steering-plan.md)  
   Adds Nudge, Pause, Redo, Cancel, lineage invalidation, approval revocation, reconciliation, and explicit brand preferences.
4. [`2026-08-30-studio-and-multimodal-output-plan.md`](./2026-08-30-studio-and-multimodal-output-plan.md)  
   Integrates source selection/resolution into the current Studio, adds hybrid multimodal output planning, updates A2UI/Telegram/monitoring/evidence, and removes final video-only UI/docs.

## Execution Gate

Do not start a later plan until the prior plan's targeted tests, TypeScript check, Python suite, lint, and production build pass. Commit each task independently using the commit message specified in that task.
