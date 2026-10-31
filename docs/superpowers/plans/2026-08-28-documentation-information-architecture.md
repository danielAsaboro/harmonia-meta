# Documentation information architecture implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan inline. Subagents are prohibited in this side conversation.

**Goal:** Make every public Harmonia document discoverable through a coherent six-tab Mintlify site with complete platform, contract, operations, and evidence references.

**Architecture:** `docs/docs.json` is the canonical navigation tree. Focused MDX landing/reference pages separate reader goals, while one Vitest audit validates the complete public documentation graph and local source references.

**Tech Stack:** Mintlify MDX, Mermaid, JSON, Vitest, TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-28-documentation-information-architecture-design.md`

## Global constraints

- Preserve current product facts and label unauthenticated integrations as pending evidence.
- Keep `docs/superpowers/` outside public navigation.
- Do not duplicate a page in navigation.
- Do not publish, deploy, or capture authenticated evidence.

### Task 1: Navigation and landing pages

- [ ] Add six short tabs with dedicated landing pages and grouped child pages.
- [ ] Add card directories and cross-links without duplicating pages.
- [ ] Verify every configured page resolves.

### Task 2: Reference coverage

- [ ] Add API, workflow state, agent contract, effect, error, Firestore, authority, configuration, upload, pricing, and receipt references.
- [ ] Use exact repository contracts and source files.

### Task 3: Consistency and de-duplication

- [ ] Add stable related-page links and consistent reference headings.
- [ ] Keep conceptual pages authoritative for rationale and reference pages authoritative for machinery.

### Task 4: Evaluation path, glossary, and diagrams

- [ ] Add an evaluator path and shared glossary.
- [ ] Add six reusable Mermaid diagrams with evidence-aware captions.

### Task 5: Documentation CI and verification

- [ ] Write failing navigation/link/orphan/frontmatter/title/source/evidence tests.
- [ ] Implement only the documentation needed to make those tests pass.
- [ ] Run focused tests, full Vitest, ESLint, TypeScript, production build, Mintlify preview checks, and `git diff --check`.
