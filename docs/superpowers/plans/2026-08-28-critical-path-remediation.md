# Harmonia Critical-Path Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove repository-local blockers to a truthful, testable Harmonia vertical slice without deploying, publishing, or changing credentials.

**Architecture:** Preserve Firestore as durable workflow truth and the existing effect-command/claim/fence boundary. Normalize all action execution against canonical `sourceAnalysis`, bind verification to immutable approved payloads, keep no-approval internal artifacts distinct from approval-required external effects, and make runtime configuration fail closed before external calls.

**Tech Stack:** Python 3.14, Google ADK 2.7.1, Next.js/TypeScript, Vitest, pytest, Firestore emulator, ffmpeg.

**Spec:** `../../../../audits/harmonia-whole-project/15-remediation-roadmap.md` (private parent-workspace audit; do not copy it into public docs)

## Global Constraints

- Do not deploy, publish, mutate credentials, call paid media APIs, or run destructive live tests.
- Preserve official API use, tenant derivation, approval receipts, idempotency keys, fencing, and unknown-outcome reconciliation.
- Use test-driven development for every behavioral change and commit independently reviewable groups.
- Never convert missing evidence or provider failure into simulated success.
- Public documentation must distinguish local verification from authenticated live evidence.

---

### Task 1: Canonical source-analysis execution

**Files:**
- Modify: `agent/harmonia_agent/stages.py`
- Test: `agent/tests/test_agent_stages.py`

**Interfaces:**
- Consumes: persisted `job.sourceAnalysis: { moments: Moment[], angles: Angle[] }`.
- Produces: `_source_moments(job)`, `_source_angles(job)`, non-empty content-pack inputs, and moment lookup for clip/reel execution.

- [ ] Add failing tests proving a job with only `sourceAnalysis` exports moments/angles and resolves render moments.
- [ ] Run the focused tests and confirm failures show obsolete top-level reads.
- [ ] Add narrow canonical accessors and replace all publish/render/media-action top-level reads.
- [ ] Run focused publish/render tests, then the complete Python suite.
- [ ] Commit as `fix(worker): execute actions from canonical source analysis`.

### Task 2: Action taxonomy and approval truth

**Files:**
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `src/lib/policy.ts`
- Modify: `src/lib/architectureExplorer.ts` or the canonical explorer dataset discovered by the test
- Modify: public demo/approval documentation that claims content-pack approval
- Test: `agent/tests/test_agent_stages.py`
- Test: `tests/policy.test.ts`
- Test: architecture/documentation contract tests

**Interfaces:**
- Consumes: `ActionType` and deterministic `evaluateActionPolicy`.
- Produces: internal `export_content_pack` mandate without a fake approval claim; approval-required X/premium-media actions; explorer labels derived from policy.

- [ ] Add failing tests for reachable meme actions using `angleType` and truthful explorer/policy labels.
- [ ] Confirm the failures are caused by `kind` and hard-coded approval metadata.
- [ ] Switch meme selection to the canonical angle taxonomy and derive presentation labels from policy.
- [ ] Rewrite demo/docs to show dashboard approval for an X action while allowing content-pack export as the safe real effect, without claiming the pack itself was approved.
- [ ] Run focused Node/Python/doc tests.
- [ ] Commit as `fix(policy): align action authority and architecture claims`.

### Task 3: Payload-bound verification and ambiguity

**Files:**
- Modify: `agent/harmonia_agent/stages.py`
- Modify: `agent/harmonia_agent/effect_executor.py` and/or `agent/harmonia_agent/web_client.py` only if the reproduced state mismatch requires it
- Modify: packet completeness contract discovered from `src/lib/packet.ts`
- Test: `agent/tests/test_agent_stages.py`
- Test: `tests/packet.test.ts`
- Test: effect execution/reconciliation tests

**Interfaces:**
- Consumes: approved command payload digest, X readback text, receipt and verification records.
- Produces: verified only when observed canonical payload equals approved intent; one verification per executed action; one normalized unknown state.

- [ ] Add failing match/mismatch/deleted-post tests and packet omission tests.
- [ ] Reproduce the `unknown`/`uncertain` boundary with a focused test.
- [ ] Implement canonical content comparison, fail-closed packet completeness, and consistent ambiguity mapping.
- [ ] Run focused Python/Node tests and emulator tests when locally available.
- [ ] Commit as `fix(effects): bind verification to approved intent`.

### Task 4: Gemini media request boundary

**Files:**
- Modify: `agent/harmonia_agent/multimodal.py` and relevant ingestion/config modules
- Modify: configuration/reference docs
- Test: corresponding Python multimodal tests

**Interfaces:**
- Consumes: media bytes/path and configured Gemini transport.
- Produces: inline requests only below a conservative total-request threshold; larger media uses the supported Files/Cloud Storage URI path or fails with an actionable non-success status.

- [ ] Add boundary tests that fail at the current 24 MiB behavior, including base64 overhead.
- [ ] Confirm the actual transport is legacy `generate_content` and identify the existing file-upload abstraction.
- [ ] Implement the smallest supported routing change without fake upload success.
- [ ] Run focused and full Python tests.
- [ ] Commit as `fix(gemini): respect multimodal request limits`.

### Task 5: Deployment and environment contract

**Files:**
- Modify: `infra/deploy.sh`, environment validation/schema files, `.env.example`, and configuration docs
- Test: deployment/configuration contract tests

**Interfaces:**
- Produces: one enumerated server-side environment schema including the connection envelope key and enabled provider OAuth credentials; deployment aborts before rollout when required values are absent.

- [ ] Add failing static/behavioral tests for missing envelope key and enabled-provider credentials.
- [ ] Implement one canonical required-variable list consumed by validation, docs, and deploy wiring where practical.
- [ ] Pin worker dependency inputs and record immutable image/build metadata without deploying.
- [ ] Run config/doc/build checks.
- [ ] Commit as `fix(deploy): complete fail-closed runtime configuration`.

### Task 6: Required interface behavior

**Files:**
- Modify: Telegram webhook/setup routes and `agent/harmonia_agent/telegram_bot.py`
- Modify: chat/A2UI stream route
- Test: Telegram, chat stream, and A2UI integration tests

**Interfaces:**
- Produces: allow-listed free-text job submission/status; official webhook setup/status; committed chat mutation remains successful if optional A2UI presentation fails.

- [ ] Add failing ordinary-message, status, webhook, unauthorized-chat, and A2UI-after-mutation tests.
- [ ] Implement canonical intent routing and webhook lifecycle without contacting Telegram in tests.
- [ ] Isolate optional presentation errors after durable mutation and return a truthful warning.
- [ ] Run focused and complete Node/Python tests.
- [ ] Commit as `fix(interfaces): complete Telegram and chat recovery paths`.

### Task 7: Security lifecycle and internal authority

**Files:**
- Modify: workspace deletion, OAuth disconnect/revocation, and internal authentication modules/routes
- Test: workspace erasure, OAuth lifecycle, and cross-tenant negative tests

**Interfaces:**
- Produces: atomic owner-pointer cleanup/rehome, complete scoped-state erasure, retryable provider revocation, and derived/signed tenant scope for internal requests.

- [ ] Add failing deletion/re-login, orphan-state, revocation-failure, and forged-tenant tests.
- [ ] Implement local transactional cleanup and explicit revocation state; do not invoke real provider revocation.
- [ ] Replace caller-selected shared-bearer tenant authority with the narrowest existing workload-identity-compatible contract.
- [ ] Run focused emulator/security suites.
- [ ] Commit as `fix(security): close deletion and internal tenant boundaries`.

### Task 8: Required quality gates and truth documentation

**Files:**
- Modify/create: checked-in CI workflow, Python lock input/output, SBOM scripts, README and maintained docs
- Test: documentation, dependency, and clean-build verification commands

**Interfaces:**
- Produces: required Firestore emulator gate, locked worker build inputs, Node/Python/OS/image inventory, accurate current agent/interface/pipeline documentation, and supersession banners for historical plans.

- [ ] Make emulator transaction suites mandatory in the checked-in gate and fail clearly when prerequisites are missing.
- [ ] Generate reproducible Python locks and release/SBOM metadata using repository-approved tooling.
- [ ] Correct obsolete roles, versions, stages, Telegram claims, API reference gaps, and navigation.
- [ ] Run full lint, Node tests including emulator, Python tests, production build, dependency audit, doc validators, and `git diff --check`.
- [ ] Commit coherent quality-gate and documentation groups separately.

## Final verification

- [ ] Confirm every repository-local P0/P1 finding has either passing closure evidence or a precise remaining external blocker.
- [ ] Run all documented local verification commands from the final worktree.
- [ ] Record skipped tests and warnings without hiding them.
- [ ] Do not claim live verification for any external integration.
