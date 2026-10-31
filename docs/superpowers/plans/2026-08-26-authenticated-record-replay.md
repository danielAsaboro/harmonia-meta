# Authenticated Record/Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a fail-closed, inert, visibly disclosed record/replay plane that lets Harmonia reproduce sanitized authenticated runs locally without spending cloud credit or generating fresh evidence.

**Architecture:** Strict Zod event envelopes are projected from live records through allowlisted sanitizers, canonicalized, and SHA-256 signed. Verified immutable bundles feed a deterministic in-memory dispatcher and isolated replay API/UI; they never write live Firestore state or invoke effect routes. A private recorder creates review candidates, while evidence verification rejects fixture and replay output as fresh proof.

**Tech Stack:** TypeScript 5, Zod 4, Node `crypto`, Next.js 16 route handlers and React 19, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-08-26-authenticated-record-replay-design.md`

## Global Constraints

- Runtime modes are exactly `fixture`, `recorded_replay`, and `live`.
- Replay is read-only, isolated from Firestore mutations, approvals, retries, credentials, publishing, receipts, and effects.
- Bundle parsing, sanitization, versioning, event unions, sequences, provenance, and integrity validation fail closed.
- Never bundle credentials, tokens, cookies, authorization headers, private keys, signed secrets, raw prompts, private chain-of-thought, arbitrary headers, unsanitized logs, or unauthorized source text.
- Every replay UI permanently displays `Recorded authenticated run — replay mode`, capture date, and bundle identity.
- Replay and fixtures never qualify as fresh provider, deployment, or submission evidence.
- No public golden bundle is created until an authenticated run exists and its sanitized candidate receives explicit release approval.
- Existing uncommitted cloud-remediation changes and `agent/.venv` are preserved; `agent/.venv` is never staged.

---

## File Structure

- `src/lib/recordReplay/schema.ts`: strict bundle/event schemas, types, versions, scenarios, runtime modes.
- `src/lib/recordReplay/integrity.ts`: canonical JSON, bundle digest creation and verification.
- `src/lib/recordReplay/sanitize.ts`: forbidden-material scanner and event-specific allowlist projectors.
- `src/lib/recordReplay/state.ts`: pure terminal-state reducer and state digest.
- `src/lib/recordReplay/importer.ts`: parse, schema/invariant/digest verification, immutable imported bundle.
- `src/lib/recordReplay/dispatcher.ts`: ordered timed playback, speed, pause/resume/stop, reconnect cursor.
- `src/lib/recordReplay/sessionStore.ts`: process-local replay sessions only; no Firestore dependency.
- `src/lib/recordReplay/recorder.ts`: candidate construction from already-fetched live observations.
- `src/lib/recordReplay/scenarios.ts`: authentic-capture status registry with no fabricated bundles.
- `src/app/api/replay/sessions/route.ts`: verified import/session creation.
- `src/app/api/replay/sessions/[id]/events/route.ts`: event retrieval after an exclusive sequence.
- `src/app/api/replay/sessions/[id]/control/route.ts`: inert playback controls only.
- `src/components/ReplayModeBanner.tsx`: mandatory disclosure banner.
- `src/app/layout.tsx`: application-level banner placement driven by signed/validated replay context.
- `scripts/record-authenticated-run.ts`: private-output-only recorder CLI.
- `scripts/verify-vertical-slice-evidence.ts`: replay/fixture evidence exclusion.
- `tests/recordReplay*.test.ts`: security, schema, digest, playback, API isolation, UI, recorder, evidence tests.

### Task 1: Fail-Closed Bundle Schema and Integrity

**Files:**
- Create: `src/lib/recordReplay/schema.ts`
- Create: `src/lib/recordReplay/integrity.ts`
- Test: `tests/recordReplayBundle.test.ts`

**Interfaces:**
- Produces: `REPLAY_SCHEMA_VERSION`, `replayBundleSchema`, `ReplayBundle`, `UnsignedReplayBundle`, `ReplayEvent`, `ReplayScenario`, `canonicalJson(value)`, `signReplayBundle(bundle)`, `verifyReplayBundleDigest(bundle)`.
- Consumes: Node `createHash`; Zod strict schemas.

- [ ] **Step 1: Write schema and integrity failure tests**

Add tests that construct a minimal `UnsignedReplayBundle`, require strict rejection of an extra key and unsupported version, require contiguous zero-based sequences and nondecreasing offsets, assert stable canonical JSON across key order, sign the bundle, and reject a payload changed after signing.

```ts
expect(() => replayBundleSchema.parse({ ...signed, unexpected: true })).toThrow();
expect(verifyReplayBundleDigest(signed)).toBe(true);
expect(verifyReplayBundleDigest({ ...signed, scenario: "rejection" })).toBe(false);
```

- [ ] **Step 2: Run the focused test and observe RED**

Run: `npx vitest run tests/recordReplayBundle.test.ts`
Expected: FAIL because `@/lib/recordReplay/schema` and integrity exports do not exist.

- [ ] **Step 3: Implement strict schemas and canonical hashing**

Define exact literal event kinds for job snapshots, stage transitions, specialist handoffs, activity summaries, transcript segments, moments, drafts, actions, approvals, effect claims, receipts, verifications, Pub/Sub deliveries, Scheduler ticks, A2UI operations, surface revisions, usage, trace correlation, and typed failures. Use `.strict()` at every object boundary. Refine the bundle for contiguous sequences, capture-window timestamps, and nondecreasing offsets. Compute `sha256` over canonical JSON with `integrity.digest` omitted.

- [ ] **Step 4: Run focused tests and observe GREEN**

Run: `npx vitest run tests/recordReplayBundle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the independently verified bundle core**

```bash
git add src/lib/recordReplay/schema.ts src/lib/recordReplay/integrity.ts tests/recordReplayBundle.test.ts
git commit -m "feat: add strict replay bundle integrity"
```

### Task 2: Allowlist Sanitizer and Deterministic State

**Files:**
- Create: `src/lib/recordReplay/sanitize.ts`
- Create: `src/lib/recordReplay/state.ts`
- Test: `tests/recordReplaySanitizer.test.ts`
- Test: `tests/recordReplayState.test.ts`

**Interfaces:**
- Consumes: `ReplayEvent`, `UnsignedReplayBundle` from Task 1.
- Produces: `sanitizeReplayObservation(input, context): ReplayEvent`, `assertNoForbiddenReplayMaterial(value): void`, `reduceReplayState(events)`, `digestReplayState(state)`.

- [ ] **Step 1: Write nested secret and source-authorization failure tests**

Use table-driven cases for `authorization`, `authorizationHeader`, `cookie`, `accessToken`, `refresh_token`, `apiKey`, `privateKey`, bearer/basic values, PEM markers, signed credential query parameters, `chainOfThought`, `rawPrompt`, and `stackTrace` at multiple nesting levels. Assert transcript/source text is rejected when `sourceCaptureAuthorized` is false. Assert sanitizer output contains only each event kind's allowlisted fields.

- [ ] **Step 2: Run sanitizer tests and observe RED**

Run: `npx vitest run tests/recordReplaySanitizer.test.ts`
Expected: FAIL because sanitizer exports do not exist.

- [ ] **Step 3: Implement projection-first sanitization**

Normalize keys for forbidden-key detection, scan scalar strings for credential patterns, validate URLs for secret query parameters, and implement an exhaustive switch that constructs new payload objects. Throw typed `ReplaySanitizationError` on unknown event kinds or forbidden input. Require `sourceCaptureAuthorized: true` before projecting transcript text or source excerpts.

- [ ] **Step 4: Write state-reduction failure tests**

Cover approval wait, rejection, transient failure followed by recovery, permanent failure, duplicate-effect suppression, scheduled autonomy, Memory Bank retrieval summary, Telegram approval, and repeat playback. Require identical terminal state and digest across repeated reductions.

- [ ] **Step 5: Implement the pure reducer and run both suites GREEN**

Run: `npx vitest run tests/recordReplaySanitizer.test.ts tests/recordReplayState.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit sanitizer and state core**

```bash
git add src/lib/recordReplay/sanitize.ts src/lib/recordReplay/state.ts tests/recordReplaySanitizer.test.ts tests/recordReplayState.test.ts
git commit -m "feat: sanitize and reduce replay observations"
```

### Task 3: Importer and Deterministic Dispatcher

**Files:**
- Create: `src/lib/recordReplay/importer.ts`
- Create: `src/lib/recordReplay/dispatcher.ts`
- Test: `tests/recordReplayImporter.test.ts`
- Test: `tests/recordReplayDispatcher.test.ts`

**Interfaces:**
- Consumes: signed bundle parsing/integrity and `digestReplayState`.
- Produces: `importReplayBundle(raw, policy): ImportedReplayBundle`; `ReplayDispatcher` with `start()`, `pause()`, `resume()`, `stop()`, `setSpeed(multiplier)`, `eventsAfter(sequence)`, `snapshot()`.

- [ ] **Step 1: Write importer rejection tests**

Reject malformed JSON, unknown versions/fields, digest mismatch, sequence gaps, terminal-state mismatch, and non-public bundles under `{ destination: "public" }`. Accept reviewed private candidates only under `{ destination: "private" }`.

- [ ] **Step 2: Run importer tests and observe RED**

Run: `npx vitest run tests/recordReplayImporter.test.ts`
Expected: FAIL because importer is absent.

- [ ] **Step 3: Implement importer with immutable output**

Parse once, validate schema/invariants, verify digest, recompute state digest, enforce destination policy, and deep-freeze the imported envelope before return.

- [ ] **Step 4: Write dispatcher timing and cursor tests using fake timers**

Assert speed multipliers alter scheduled delay, pause emits nothing until resume, stop is terminal, `eventsAfter(4)` starts at sequence 5, equal timestamps remain sequence-ordered, and completed playback matches the imported expected state.

- [ ] **Step 5: Implement dispatcher and run both suites GREEN**

Run: `npx vitest run tests/recordReplayImporter.test.ts tests/recordReplayDispatcher.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit deterministic playback**

```bash
git add src/lib/recordReplay/importer.ts src/lib/recordReplay/dispatcher.ts tests/recordReplayImporter.test.ts tests/recordReplayDispatcher.test.ts
git commit -m "feat: verify and dispatch recorded runs"
```

### Task 4: Isolated Replay API and Permanent UI Disclosure

**Files:**
- Create: `src/lib/recordReplay/sessionStore.ts`
- Create: `src/app/api/replay/sessions/route.ts`
- Create: `src/app/api/replay/sessions/[id]/events/route.ts`
- Create: `src/app/api/replay/sessions/[id]/control/route.ts`
- Create: `src/components/ReplayModeBanner.tsx`
- Modify: `src/app/layout.tsx`
- Test: `tests/recordReplayApi.test.ts`
- Test: `tests/recordReplayUi.test.ts`

**Interfaces:**
- Consumes: `importReplayBundle`, `ReplayDispatcher`.
- Produces: process-local `createReplaySession`, `getReplaySession`, GET events after cursor, POST controls `{ action: "pause" | "resume" | "stop" | "speed", speed?: number }`, and `ReplayModeBanner`.

- [ ] **Step 1: Write API isolation tests**

Create a reviewed signed test bundle, import it through the session route, reconnect with `after`, and exercise controls. Spy on or source-scan live mutation modules to prove replay modules do not import Firestore, effect claims, job decisions, retry, receipt, OAuth, or publishing code. Reject bundle paths and arbitrary server filesystem reads; accept bundle JSON only within the configured local size limit.

- [ ] **Step 2: Run API tests and observe RED**

Run: `npx vitest run tests/recordReplayApi.test.ts`
Expected: FAIL because replay routes and store do not exist.

- [ ] **Step 3: Implement the process-local session API**

Store immutable imported bundles and dispatcher instances in a bounded process-local map. Require development mode or an explicit replay enable flag. Include `executionMode`, bundle ID, capture time, scenario, evidence classification, status, speed, and last sequence in every response. Do not expose mutation-like controls beyond playback state.

- [ ] **Step 4: Write banner and mutation-suppression tests**

Render the banner and assert the exact disclosure, capture date, bundle ID, historical-evidence warning, and non-dismissible structure. Assert replay presentation adapters mark confirmation and effect controls disabled/historical.

- [ ] **Step 5: Implement UI disclosure and run suites GREEN**

Render `ReplayModeBanner` at the application-shell level when validated replay metadata is present. The component itself owns the exact disclosure copy; bundle content cannot override it.

Run: `npx vitest run tests/recordReplayApi.test.ts tests/recordReplayUi.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit isolated API/UI**

```bash
git add src/lib/recordReplay/sessionStore.ts src/app/api/replay src/components/ReplayModeBanner.tsx src/app/layout.tsx tests/recordReplayApi.test.ts tests/recordReplayUi.test.ts
git commit -m "feat: expose inert replay sessions"
```

### Task 5: Private Recorder, Scenario Registry, and Evidence Exclusion

**Files:**
- Create: `src/lib/recordReplay/recorder.ts`
- Create: `src/lib/recordReplay/scenarios.ts`
- Create: `scripts/record-authenticated-run.ts`
- Modify: `package.json`
- Modify: `scripts/verify-vertical-slice-evidence.ts`
- Modify: `src/lib/verticalSliceEvidence.ts`
- Create: `docs/record-replay.mdx`
- Test: `tests/recordReplayRecorder.test.ts`
- Test: `tests/recordReplayEvidence.test.ts`
- Test: `tests/recordReplayDocs.test.ts`

**Interfaces:**
- Consumes: sanitizer, state reducer, signer.
- Produces: `recordAuthenticatedRun(input): ReplayBundle`; nine-entry `GOLDEN_SCENARIOS`; `npm run replay:record -- --input <private-json> --output <private-path>`.

- [ ] **Step 1: Write recorder and registry failure tests**

Assert raw observations containing forbidden material abort the whole recording, the output defaults to `private_candidate`, public approval cannot be inferred, output paths under the public repository are rejected unless an explicit reviewed-release operation is used, and all nine scenario registry entries start at `not_captured` without bundle paths.

- [ ] **Step 2: Run recorder tests and observe RED**

Run: `npx vitest run tests/recordReplayRecorder.test.ts`
Expected: FAIL because recorder and registry are absent.

- [ ] **Step 3: Implement recorder library and private-output CLI**

Accept an already-collected JSON observation set, sanitize every record, order and sequence it, compute terminal state, attach provenance, sign it, and write only to a validated path outside the public repository. Print bundle ID, digest, scenario, and output path only; never print content.

- [ ] **Step 4: Write evidence exclusion and documentation tests**

Pass bundles classified `fixture`, `recorded_replay`, or `historical_replay` to vertical-slice verification and require a typed failure. Verify docs contain the three modes, banner wording, private/public review boundary, no-fresh-evidence rule, scenario status policy, and one-live-run/scale-down sequence.

- [ ] **Step 5: Implement evidence guard and operator docs**

Add an early evidence-classification guard to `verifyVerticalSliceEvidence`. Document capture authorization, private storage, review/release, local replay controls, cost discipline, and the prohibition on fabricating missing scenarios.

- [ ] **Step 6: Run Task 5 suites GREEN and commit**

Run: `npx vitest run tests/recordReplayRecorder.test.ts tests/recordReplayEvidence.test.ts tests/recordReplayDocs.test.ts`
Expected: PASS.

```bash
git add src/lib/recordReplay/recorder.ts src/lib/recordReplay/scenarios.ts scripts/record-authenticated-run.ts package.json scripts/verify-vertical-slice-evidence.ts src/lib/verticalSliceEvidence.ts docs/record-replay.mdx tests/recordReplayRecorder.test.ts tests/recordReplayEvidence.test.ts tests/recordReplayDocs.test.ts
git commit -m "feat: record sanitized authenticated runs"
```

### Task 6: Cross-System Verification and Cloud-Resume Gate

**Files:**
- Modify only if verification reveals an in-scope defect; use the failing test cycle before any fix.
- Create privately after a real run: `../../submission/evidence/replay/<bundle-id>.json`

**Interfaces:**
- Consumes: all preceding tasks.
- Produces: verified local implementation and an explicit decision whether cloud deployment may resume.

- [ ] **Step 1: Run focused record/replay tests**

Run: `npx vitest run tests/recordReplayBundle.test.ts tests/recordReplaySanitizer.test.ts tests/recordReplayState.test.ts tests/recordReplayImporter.test.ts tests/recordReplayDispatcher.test.ts tests/recordReplayApi.test.ts tests/recordReplayUi.test.ts tests/recordReplayRecorder.test.ts tests/recordReplayEvidence.test.ts tests/recordReplayDocs.test.ts`
Expected: PASS.

- [ ] **Step 2: Run all application verification**

Run: `npm test`
Expected: PASS with no skipped record/replay security tests.

Run: `npm run lint`
Expected: exit 0.

Run: `npx tsc --noEmit`
Expected: exit 0.

Run: `npm run build`
Expected: exit 0.

- [ ] **Step 3: Re-run agent and infrastructure regressions**

Run: `npm run test:agent`
Expected: PASS.

Run: `npx vitest run tests/infraDeployment.test.ts tests/infraScripts.test.ts`
Expected: PASS.

- [ ] **Step 4: Audit repository safety**

Run: `git diff --check`
Expected: no output.

Run: `git status --short`
Expected: only known cloud-remediation changes; `agent/.venv` remains untracked and unstaged; no golden bundle or raw evidence appears in the public repository.

- [ ] **Step 5: Commit any verification-only corrections and mark the cloud gate open**

Do not claim authenticated replay capture yet. Once all local checks pass, resume exactly one meaningful Agent Engine deployment attempt and one authenticated vertical slice. Record the resulting raw data privately, create a sanitized candidate, verify local replay terminal-state equality, request explicit public release approval if desired, and then scale costly resources down.
