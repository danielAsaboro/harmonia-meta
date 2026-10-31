# Vertical-Slice Evidence Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed public verifier and private collector for one authenticated Harmonia YouTube-to-verified-effect run, without committing private source material or allowing the harness to manufacture approval or success.

**Architecture:** The public repository defines a strict Zod evidence-bundle contract plus deterministic cross-record invariants and a CLI verifier. A private parent-level Python collector queries only the deployed Harmonia and Google Cloud resources named by an operator-owned run configuration, saves raw exports under `submission/evidence/`, and assembles a redacted bundle for the public verifier. Collection is resumable and phase-separated: prepare/capture may stop at `awaiting_approval`; completion requires an already persisted human approval record and independently fetched effect verification.

**Tech Stack:** TypeScript, Zod, Vitest, `tsx`, Python 3.12 standard library, Google Cloud CLI, Harmonia REST/internal evidence endpoints, SHA-256.

**Spec:** `docs/superpowers/specs/2026-08-24-gear-prioritized-hardening-design.md` sections 1 and 7; private audit `../resources/gear-harmonia-audit.md` Path 1 P0.

## Global Constraints

- A bundle produced from `HARMONIA_MOCK_AI=1`, `HARMONIA_MOCK_X=1`, emulators, localhost, scripted models, or missing provider evidence must fail verification.
- The verifier proves internal consistency of captured evidence; it cannot convert self-asserted JSON into authenticated cloud proof.
- Raw transcripts, drafts, credentials, session cookies, tokens, private logs, and screenshots stay outside the public repository.
- The collector never approves, publishes, changes credentials, purchases, or sends an external message. It observes an approval already persisted through Harmonia's normal decision engine.
- Trace lineage must correlate web request, Pub/Sub progression, agent invocation, approval/claim/effect, receipt, and verification. Separate operator requests may start distinct traces; replay proof must be a distinct traced attempt.
- Evidence timestamps use timezone-aware ISO 8601 UTC strings; digests are lowercase SHA-256.
- The first real effect may be an exported content pack only when it contains Gemini-derived artifacts and independent digest verification; no fake/social mock receipt is accepted.

---

### Task 1: Public evidence bundle contract and invariants

**Files:**
- Create: `src/lib/verticalSliceEvidence.ts`
- Create: `tests/verticalSliceEvidence.test.ts`

**Interfaces:**
- Produces: `verticalSliceEvidenceSchema`, `VerticalSliceEvidence`, `EvidenceFailure`, and `verifyVerticalSliceEvidence(input: unknown): EvidenceVerification`.
- Consumes: no private files; only a redacted JSON-shaped bundle.

- [ ] **Step 1: Write failing schema and invariant tests**

Create tests with a single `validBundle()` fixture and mutations proving rejection of mock/emulator provenance, non-Gemini-3.5 cognition, missing Agent Engine resource, missing stage, out-of-order timestamps, broken trace lineage, approval after effect, missing or late effect claim, missing idempotency key, duplicate operation IDs, unverified effect, verification before receipt, unknown cost, sum mismatch, and raw/private fields.

```ts
it("accepts a complete authenticated redacted bundle", () => {
  expect(verifyVerticalSliceEvidence(validBundle())).toEqual({ ok: true, failures: [] });
});

it("rejects effect execution before durable human approval", () => {
  const bundle = validBundle();
  bundle.approval.decidedAt = "2026-08-24T12:10:00.000Z";
  bundle.effect.executedAt = "2026-08-24T12:09:00.000Z";
  expect(verifyVerticalSliceEvidence(bundle).failures).toContainEqual(
    expect.objectContaining({ code: "effect_before_approval" }),
  );
});

it("rejects mock or emulator provenance", () => {
  const bundle = validBundle();
  bundle.environment.mockAi = true;
  expect(verifyVerticalSliceEvidence(bundle).failures).toContainEqual(
    expect.objectContaining({ code: "non_production_provenance" }),
  );
});
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/verticalSliceEvidence.test.ts`

Expected: import failure because `verticalSliceEvidence.ts` does not exist.

- [ ] **Step 3: Implement strict models and all-failure verification**

Use `.strict()` for every Zod object. The top-level bundle contains exactly:

```ts
{
  schemaVersion, runId, capturedAt,
  source: { kind, sourceId, authorizationRef, metadataDigest },
  environment: { projectId, location, webService, webRevision, agentService,
    agentRevision, agentEngineResource, firestoreDatabase, pubsubTopic,
    mockAi, mockEffects, emulator },
  job: { workspaceId, brandId, jobId, createdAt, completedAt },
  events: [{ eventId, stage, status, at, operationId, pubsubMessageId, traceId }],
  cognition: [{ role, model, provider, policyVersion, usageRecordId, operationId, traceId }],
  approval: { approvalId, actionId, decision, actorType, decidedAt, traceId },
  claim: { claimId, actionId, idempotencyKey, state, receiptId, attempt, claimedAt, finalizedAt, operationId, traceId },
  effect: { actionId, operationId, idempotencyKey, receiptId, kind, outcome, executedAt, artifactDigest, traceId },
  verification: { verificationId, receiptId, operationId, method, status, checkedAt, observedDigest, traceId },
  costs: { pricingVersion, currency, records: [{ usageRecordId, operationId, estimatedUsd, observedUsd }], totalEstimatedUsd, totalObservedUsd },
  evidenceFiles: [{ kind, relativePath, sha256 }]
}
```

`verifyVerticalSliceEvidence` first returns schema failures, then deterministic invariant failures with stable codes. Use integer USD micros for summation; never floating-point addition.

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run tests/verticalSliceEvidence.test.ts`

Expected: all evidence contract tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/verticalSliceEvidence.ts tests/verticalSliceEvidence.test.ts
git commit -m "feat: verify authenticated vertical-slice evidence"
```

### Task 2: Public verifier CLI and redaction guard

**Files:**
- Create: `scripts/verify-vertical-slice-evidence.ts`
- Create: `tests/verticalSliceEvidenceCli.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: `verifyVerticalSliceEvidence` and a JSON path.
- Produces: `npm run verify:evidence -- /absolute/private/bundle.json`; exit `0` only for a valid bundle and JSON summary on stdout.

- [ ] **Step 1: Write failing CLI tests**

Spawn `npx tsx scripts/verify-vertical-slice-evidence.ts` against temporary valid/invalid JSON. Assert invalid JSON, schema violations, private-key names (`token`, `cookie`, `transcript`, `draftText`, `authorizationHeader`), absolute evidence-file paths, and paths containing `..` exit non-zero without echoing secret values.

```ts
expect(runCli(validPath).status).toBe(0);
const failed = runCli(secretPath);
expect(failed.status).not.toBe(0);
expect(failed.stdout).not.toContain("super-secret");
```

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/verticalSliceEvidenceCli.test.ts`

Expected: CLI file and script are missing.

- [ ] **Step 3: Implement the fail-closed CLI**

Read the file once, recursively scan key names before schema parsing, print only stable failure codes/paths, and never serialize input values on failure. Add:

```json
"verify:evidence": "tsx scripts/verify-vertical-slice-evidence.ts"
```

- [ ] **Step 4: Verify GREEN**

Run: `npx vitest run tests/verticalSliceEvidenceCli.test.ts && npm run verify:evidence -- /tmp/harmonia-valid-evidence.json`

Expected: tests pass; valid bundle exits zero.

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-vertical-slice-evidence.ts tests/verticalSliceEvidenceCli.test.ts package.json
git commit -m "feat: add evidence verification CLI"
```

### Task 3: Private read-only evidence collector

**Files (private parent; never commit to public repo):**
- Create: `../submission/evidence-runner/collect_vertical_slice.py`
- Create: `../submission/evidence-runner/test_collect_vertical_slice.py`
- Create: `../submission/evidence-runner/README.md`

**Interfaces:**
- Produces: `CollectorConfig`, `CommandResult`, `EvidenceCollector.collect()`, redacted `bundle.json`, raw `exports/*.json`, `commands/*.json`, and `SHA256SUMS` under an explicit private run directory.
- Consumes: absolute run config path, deployed HTTPS web URL, authenticated `gcloud`, an operator-exported authenticated API cookie file, project/location/service names, job ID, and public verifier command.

- [ ] **Step 1: Write failing collector-boundary tests**

Use injected command and HTTP executors. Assert refusal of relative/output paths inside `harmonia/`, localhost/emulator URLs, missing active gcloud account/project, config project mismatch, mock flags, credential values in serialized output, absent approval, and verification that predates the receipt. Assert command failures remain failures and are recorded without stdout secrets.

- [ ] **Step 2: Verify RED**

Run: `python3 -m unittest submission/evidence-runner/test_collect_vertical_slice.py -v`

Expected: import failure because collector does not exist.

- [ ] **Step 3: Implement collection without mutation**

The collector may call only GET/read commands: Cloud Run service/revision describe, Pub/Sub topic/subscription describe, Firestore export/query helper, Harmonia job/events/receipts/usage/verification endpoints, and trace lookup. It must not call decision, publish, retry, credential, deployment, or POST endpoints. Normalize command outputs into the public schema, hash every raw export, run the public verifier, and retain verifier stdout/exit status.

- [ ] **Step 4: Verify GREEN**

Run: `python3 -m unittest submission/evidence-runner/test_collect_vertical_slice.py -v`

Expected: all collector boundary tests pass with injected real-shaped responses.

- [ ] **Step 5: Record private implementation status**

Update `../submission/evidence/README.md` with the collector command and state that fixtures prove collection logic only, not authenticated cloud execution. Do not create a Git commit for private parent files.

### Task 4: Operator checkpoint and resumable live-run protocol

**Files:**
- Create: `docs/evidence-runbook.mdx`
- Modify: `docs/configuration.mdx`
- Modify: `README.md`
- Modify private: `../submission/evidence-runner/README.md`

**Interfaces:**
- Produces: exact `preflight`, `capture-awaiting-approval`, and `capture-complete` commands.
- Consumes: the collector and public verifier from Tasks 1–3.

- [ ] **Step 1: Add documentation assertions**

Add a small Vitest source contract asserting the runbook contains `HARMONIA_MOCK_AI`, `HARMONIA_MOCK_X`, `awaiting_approval`, `already_applied`, `Agent Engine`, `Cloud Run revision`, `traceId`, and the private/public boundary.

- [ ] **Step 2: Verify RED**

Run: `npx vitest run tests/evidenceRunbook.test.ts`

Expected: missing runbook failure.

- [ ] **Step 3: Write the exact phase protocol**

Document that preflight proves authentication and resources; capture-awaiting-approval proves the model/workflow half and stops; the operator approves through the normal dashboard; capture-complete reads the persisted decision/effect/verification; a replay through the normal UI must yield `already_applied`; the collector never performs either action.

- [ ] **Step 4: Verify GREEN and full regression suite**

Run:

```bash
npx vitest run tests/evidenceRunbook.test.ts
npm test
npm run test:agent
npx eslint src tests scripts
npm run build
git diff --check
```

Expected: no failures; existing warnings reported exactly.

- [ ] **Step 5: Commit**

```bash
git add README.md docs/evidence-runbook.mdx docs/configuration.mdx tests/evidenceRunbook.test.ts
git commit -m "docs: add authenticated evidence runbook"
```

### Task 5: Readiness audit and first real capture attempt

**Files (private):**
- Create: `../submission/evidence/cloud-readiness-2026-08-24.md`
- Create on a real attempt: `../submission/evidence/vertical-slice-<run-id>/...`

**Interfaces:**
- Consumes: active gcloud identity/project, deployed services, Agent Engine resource, configured provider credentials, authorized YouTube URL, and an operator-created job/approval.
- Produces: a factual readiness matrix and, only when prerequisites exist, a verifier-passing evidence bundle.

- [ ] **Step 1: Run read-only preflight**

Capture active account, project, region, Cloud Run services/revisions, Agent Engine resource, Firestore database, Pub/Sub topic/subscription, Secret Manager secret metadata, and configured application health. Store redacted command results privately.

- [ ] **Step 2: Classify every prerequisite**

Use `verified`, `missing`, `unauthorized`, or `unverified`; never `pass` based on configuration shape alone.

- [ ] **Step 3: Run the live phases only when preflight is verified**

If preflight is incomplete, stop before mutations and preserve the missing prerequisites. If verified, use the normal application to create the authorized job, capture awaiting approval, wait for the operator's normal approval, capture completion and replay evidence, then run `npm run verify:evidence`.

- [ ] **Step 4: Preserve the honest result**

Record verifier output and all remaining gaps. A failed provider/effect/verification stays failed; do not edit the bundle to green.

- [ ] **Step 5: Update goal status only if the entire roadmap is proven**

This evidence task alone does not complete the broader GEAR goal; continue to Projects B and C unless every audit requirement is already verified.
