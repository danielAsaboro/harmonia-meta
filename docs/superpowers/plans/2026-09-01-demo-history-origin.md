# Demo History Origin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run an idempotent operator utility that creates an isolated, non-executable copy of Harmonia job history whose earliest timestamp is August 27, 2026.

**Architecture:** Pure transformation code discovers timestamps, computes one offset, rewrites copied values, and generates deterministic demo identities. A Firestore adapter discovers job descendants and job-bound brand records, stores display-safe copies plus a manifest, and refuses collisions; worker-watched execution records are archived beneath the manifest rather than recreated in live collections.

**Tech Stack:** TypeScript, Node.js, Firebase Admin Firestore, Vitest, Firestore emulator, `tsx`.

**Spec:** `docs/superpowers/specs/2026-09-01-demo-history-origin-design.md`

## Global Constraints

- Anchor the earliest copied timestamp at exactly `2026-08-27T00:00:00.000Z`.
- Preserve every relative interval by applying one millisecond offset.
- Never modify a source Firestore document or Cloud Storage object.
- Never create demo records in worker-watched outbox, command, claim, lease, recovery, scheduler, or effect collections.
- Mark every copied document with `teaching_demo` provenance.
- Refuse an existing destination rather than overwrite it.
- `--apply` requires the exact digest emitted by `--dry-run`.
- Do not modify or commit the unrelated untracked `pnpm-lock.yaml`.

---

### Task 1: Pure demo-history transformation

**Files:**
- Create: `src/lib/demoHistory.ts`
- Test: `tests/demoHistory.test.ts`

**Interfaces:**
- Produces: `isIsoInstant(value: unknown): value is string`
- Produces: `collectInstants(value: unknown): number[]`
- Produces: `shiftDemoValue(value: unknown, offsetMs: number): unknown`
- Produces: `demoDocumentId(datasetId: string, sourcePath: string): string`
- Produces: `buildDemoProvenance(input): DemoProvenance`

- [ ] **Step 1: Write failing transformation tests**

```ts
import { Timestamp } from "firebase-admin/firestore";
import { collectInstants, demoDocumentId, shiftDemoValue } from "../src/lib/demoHistory";

test("shifts nested ISO instants and Firestore timestamps by one offset", () => {
  const input = { createdAt: "2026-08-30T12:00:00.000Z", nested: [Timestamp.fromDate(new Date("2026-08-31T12:00:00.000Z"))] };
  expect(shiftDemoValue(input, -3 * 86_400_000)).toEqual({
    createdAt: "2026-08-27T12:00:00.000Z",
    nested: [Timestamp.fromDate(new Date("2026-08-28T12:00:00.000Z"))],
  });
});

test("does not alter non-time strings", () => {
  expect(shiftDemoValue({ id: "2026-08-30", text: "created 2026-08-30T12:00Z" }, 10)).toEqual({ id: "2026-08-30", text: "created 2026-08-30T12:00Z" });
});

test("collects every complete instant and generates stable ids", () => {
  expect(collectInstants({ a: "2026-08-30T00:00:00.000Z", b: ["no"] })).toEqual([1788048000000]);
  expect(demoDocumentId("aug27", "workspaces/w/jobs/j1")).toBe(demoDocumentId("aug27", "workspaces/w/jobs/j1"));
});
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run tests/demoHistory.test.ts`
Expected: FAIL because `src/lib/demoHistory.ts` does not exist.

- [ ] **Step 3: Implement minimal pure transformations**

```ts
export function shiftDemoValue(value: unknown, offsetMs: number): unknown {
  if (typeof value === "string" && isIsoInstant(value)) return new Date(Date.parse(value) + offsetMs).toISOString();
  if (value instanceof Timestamp) return Timestamp.fromMillis(value.toMillis() + offsetMs);
  if (Array.isArray(value)) return value.map((item) => shiftDemoValue(item, offsetMs));
  if (isPlainObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftDemoValue(item, offsetMs)]));
  return value;
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run: `npx vitest run tests/demoHistory.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/demoHistory.ts tests/demoHistory.test.ts
git commit -m "feat: add demo history transformations"
```

### Task 2: Firestore discovery and quarantined copy plan

**Files:**
- Create: `src/lib/demoHistoryStore.ts`
- Test: `tests/demoHistoryFirestore.integration.test.ts`

**Interfaces:**
- Consumes: Task 1 transformation functions.
- Produces: `discoverDemoHistory(input: DemoHistoryInput): Promise<DemoHistoryPlan>`
- Produces: `applyDemoHistory(plan: DemoHistoryPlan, expectedDigest: string): Promise<DemoHistoryManifest>`
- Produces: `verifyDemoHistory(manifestPath: string): Promise<DemoHistoryVerification>`

- [ ] **Step 1: Write failing emulator test for discovery and isolation**

```ts
it("copies job history to demo paths and quarantines executable records", async () => {
  await db().doc("workspaces/w/jobs/j1").set({ id: "j1", workspaceId: "w", brandId: "b", createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z", status: "complete", stage: "complete" });
  await db().doc("workspaces/w/jobs/j1/stage_attempts/a1").set({ jobId: "j1", createdAt: "2026-08-30T01:00:00.000Z" });
  await db().doc("workspaces/w/brands/b/production_operation_outbox/o1").set({ jobId: "j1", state: "pending", createdAt: "2026-08-30T02:00:00.000Z" });
  const plan = await discoverDemoHistory({ workspaceId: "w", brandId: "b", datasetId: "aug27", anchor: "2026-08-27T00:00:00.000Z" });
  const manifest = await applyDemoHistory(plan, plan.digest);
  expect(manifest.minimumDemoTimestamp).toBe("2026-08-27T00:00:00.000Z");
  expect((await db().collection("workspaces/w/jobs").where("demoProvenance.datasetId", "==", "aug27").get()).size).toBe(1);
  expect((await db().collection("workspaces/w/brands/b/production_operation_outbox").where("demoProvenance.datasetId", "==", "aug27").get()).empty).toBe(true);
  expect((await db().collection("workspaces/w/brands/b/demo_datasets/aug27/records").get()).size).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run emulator test and verify RED**

Run: `npm run test:integration -- --run tests/demoHistoryFirestore.integration.test.ts`
Expected: FAIL because `demoHistoryStore` does not exist.

- [ ] **Step 3: Implement recursive discovery, path mapping, quarantine, digest, and batched creates**

```ts
const EXECUTABLE_COLLECTIONS = new Set([
  "stage_outbox", "production_operation_outbox", "event_inbox", "event_outbox",
  "effect_commands", "operation_claims", "recovery_work", "scheduler_outbox",
]);

export async function applyDemoHistory(plan: DemoHistoryPlan, expectedDigest: string) {
  if (expectedDigest !== plan.digest) throw new Error("demo history plan digest mismatch");
  const manifestRef = db().doc(plan.manifestPath);
  if ((await manifestRef.get()).exists) throw new Error("demo dataset already exists");
  // Use create-only BulkWriter operations; executable records go beneath manifest/records.
}
```

- [ ] **Step 4: Add collision and source-immutability assertions**

Add literal expectations that a second apply rejects with `demo dataset already exists` and that source document snapshots are byte-for-byte equal before and after apply.

- [ ] **Step 5: Run integration suite and verify GREEN**

Run: `npm run test:integration`
Expected: every Firestore integration test passes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/demoHistoryStore.ts tests/demoHistoryFirestore.integration.test.ts
git commit -m "feat: copy isolated demo job history"
```

### Task 3: Operator CLI, live dry run, apply, and verification

**Files:**
- Create: `scripts/create-demo-history.ts`
- Modify: `package.json`
- Test: `tests/demoHistoryCli.test.ts`

**Interfaces:**
- Consumes: `discoverDemoHistory`, `applyDemoHistory`, and `verifyDemoHistory` from Task 2.
- Produces commands: `npm run demo-history -- --dry-run ...`, `--apply --expected-digest ...`, and `--verify ...`.

- [ ] **Step 1: Write failing CLI argument tests**

```ts
expect(parseDemoHistoryArgs(["--dry-run", "--workspace", "w", "--brand", "b", "--dataset", "aug27", "--anchor", "2026-08-27T00:00:00.000Z"])).toEqual({
  mode: "dry-run", workspaceId: "w", brandId: "b", datasetId: "aug27", anchor: "2026-08-27T00:00:00.000Z",
});
expect(() => parseDemoHistoryArgs(["--apply", "--workspace", "w"])).toThrow(/required/);
```

- [ ] **Step 2: Run CLI test and verify RED**

Run: `npx vitest run tests/demoHistoryCli.test.ts`
Expected: FAIL because the CLI module does not exist.

- [ ] **Step 3: Implement strict argument parsing and JSON output**

```ts
if (args.mode === "dry-run") console.log(JSON.stringify(await discoverDemoHistory(args), null, 2));
if (args.mode === "apply") console.log(JSON.stringify(await applyDemoHistory(await discoverDemoHistory(args), args.expectedDigest), null, 2));
if (args.mode === "verify") console.log(JSON.stringify(await verifyDemoHistory(args.manifestPath), null, 2));
```

The apply result includes a non-executed cleanup command containing the exact manifest path and copied destination paths. Cleanup is never run automatically.

- [ ] **Step 4: Run focused tests, full tests, lint, and type checking**

Run: `npx vitest run tests/demoHistory.test.ts tests/demoHistoryCli.test.ts`
Expected: PASS.

Run: `npm run test:integration`
Expected: PASS.

Run: `npm run lint && npx tsc --noEmit && git diff --check`
Expected: all commands exit zero.

- [ ] **Step 5: Commit the CLI**

```bash
git add scripts/create-demo-history.ts package.json tests/demoHistoryCli.test.ts
git commit -m "feat: add demo history operator command"
```

- [ ] **Step 6: Run the live dry run**

Run:

```bash
npm run demo-history -- --dry-run --workspace ws_7906a5be345a41e50b2fd361 --brand brand_e58c6e1b0461fa672d0b35da --dataset sibling-demo-2026-08-27 --anchor 2026-08-27T00:00:00.000Z
```

Expected: JSON with a nonzero source job count, an exact anchor, zero unsafe live destination writes, and a plan digest.

- [ ] **Step 7: Apply the exact dry-run digest**

Run the same command with `--apply --expected-digest <digest emitted by Step 6>`.
Expected: a created manifest and nonzero copied record count; no source updates.

- [ ] **Step 8: Verify the live dataset**

Run the command with `--verify --manifest workspaces/ws_7906a5be345a41e50b2fd361/brands/brand_e58c6e1b0461fa672d0b35da/demo_datasets/sibling-demo-2026-08-27`.
Expected: `sourceUnchanged: true`, `minimumTimestampMatchesAnchor: true`, `relativeIntervalsPreserved: true`, `executableDestinationCount: 0`, and `manifestDigestMatches: true`.

- [ ] **Step 9: Record final status**

Run: `git status --short && git log -4 --oneline`
Expected: only the pre-existing untracked `pnpm-lock.yaml`; three coherent feature commits plus the design/plan commits.
