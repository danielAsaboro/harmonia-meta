# GEAR Project C: Tool and Skill Contracts

**Goal:** Make every ADK-exposed Harmonia tool discoverable, least-privilege, consistently observable, and incapable of hiding errors or causing external effects.

## Task 1 — Contract registry and uniform envelope

Add a strict `ToolContract` model declaring verb-noun name, purpose, input/return shape, stable error codes, permission (`read` only), data scope, timeout, retry policy, and external-effect classification. Every tool returns exactly `{status, data, error, evidence}`. Contract validation must fail startup/tests for an unregistered tool, vague name/docstring, missing type annotation, mutation permission, unknown retry policy, or side effect.

## Task 2 — Normalize all liaison tools

Wrap trend fetch/search, engagement insight, operator feed, job status, and posting-window derivation. Preserve real data paths and offline development fixtures, but mark mock provenance in the envelope. Map validation, not-found, authorization, provider-transient, provider-permanent, dependency, and protocol errors without provider bodies or credentials. No tool may publish, approve, retry a job, change credentials/budgets, or mutate Firestore.

## Task 3 — Skill guidance and evaluation

Update each skill to name its allowed tool(s), required call order, evidence citation rule, absence/failure behavior, retry ceiling, and escalation path. Add deterministic evaluations proving correct selection, grounding in returned evidence, visible error reporting, and refusal of approval/publishing authority.

## Task 4 — Public tool matrix and verification

Publish `docs/tool-contracts.mdx` with the exact inputs, outputs, errors, scope, timeout/retry, permissions, side effects, and skill mapping. Explicitly record MCP as deferred until a measured read-only need justifies an authenticated remote server and allow-list.

Run all focused tests, then the TypeScript and Python suites, lint, build, and `git diff --check`. Integrate only after every exposed tool is registered and the complete repository remains green.
