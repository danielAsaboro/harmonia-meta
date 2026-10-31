# Nimi Analyst Refinement Implementation Plan

**Goal:** Make Nimi produce a complete, provenance-bound source analysis that deterministic code validates, digests, persists, and passes unchanged to Ryan.

**Architecture:** Replace free-form analyst context and thin analysis output with strict Python/TypeScript contracts. Keep Nimi tool-free and agentic; keep validation, digesting, persistence, stage advancement, and authority deterministic.

## Constraints

- Inline execution only; no subagents.
- Clean cut only: no aliases, dual reads, or migration adapters.
- No paid calls, deployment, publishing, mocks, or fabricated authenticated evidence.
- Preserve unrelated files.

## Tasks

- [ ] Add failing Python and TypeScript contract tests for strict typed source, performance, memory, moments, angles, assumptions, confidence, and reference kinds.
- [ ] Implement schema parity and a focused Nimi prompt module.
- [ ] Add failing runtime tests for quote/time/segment/frame grounding, cross-kind or invented references, unsupported trends/visual claims, memory authorization, final copy, strategy, and effect overreach.
- [ ] Implement deterministic analysis validation and canonical digesting.
- [ ] Add failing stage/persistence tests proving complete typed input assembly, exact persisted analysis, digest binding, and unchanged Ryan handoff.
- [ ] Implement Firestore persistence and UI provenance rendering.
- [ ] Add public evaluation fixtures for good and adversarial cases; update current architecture documentation and labels.
- [ ] Run focused tests, complete Python and Vitest suites, ESLint, TypeScript checking, production build, `git diff --check`, and critical diff review.
- [ ] Commit the verified branch, fast-forward local main, rerun merged suites, and clean only Nimi's worktree and branch.
