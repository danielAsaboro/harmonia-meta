import { afterAll, describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import { db } from "@/lib/firestore";
import { OperationalUpdateFeedStore } from "@/lib/operations/updateFeedStore";
import { runWithTenant } from "@/lib/tenancy";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const workspaceId = `operation-feed-test-${Date.now()}`;
const scope = {
  workspaceId,
  brandId: "brand-test",
  principal: servicePrincipal("operation-feed-integration"),
};

describe.skipIf(!emulator)("operational update Firestore sequence", () => {
  it("allocates contiguous sequences under concurrent appends and resumes after a cursor", async () => {
    const store = new OperationalUpdateFeedStore(db());
    const occurredAt = "2026-08-31T00:00:00.000Z";
    const created = await runWithTenant(scope, () => Promise.all([
      store.append({ type: "job_shell_removed", occurredAt, jobId: "job-a" }),
      store.append({ type: "job_shell_removed", occurredAt, jobId: "job-b" }),
    ]));
    expect(created.map((event) => event.sequence).sort((a, b) => a - b)).toEqual([0, 1]);

    const resumed = await runWithTenant(scope, () => store.listAfter(0, 100));
    expect(resumed).toHaveLength(1);
    expect(resumed[0].sequence).toBe(1);
  });

  it("emits only projection changes and preserves a reconnectable cursor", async () => {
    const store = new OperationalUpdateFeedStore(db());
    const occurredAt = "2026-08-31T00:00:01.000Z";
    const first = await runWithTenant(scope, () => store.synchronize({
      occurredAt,
      jobs: [{ jobId: "job-c", lifecycle: "active", stage: "draft", controlState: "running", controlEpoch: 0, currentStep: "draft", progress: { completedSteps: 7, totalSteps: 12 }, backgroundLiveness: "working", lastEventSequence: -1, lastProgressAt: occurredAt, approvalCount: 0, attentionCount: 0, unknownEffectCount: 0, needsAttention: false }],
      attention: [],
    }));
    expect(first).toHaveLength(1);
    if (first[0]?.type !== "job_shell_upserted") throw new Error("expected shell projection event");
    const projectedShell = first[0].shell;
    const unchanged = await runWithTenant(scope, () => store.synchronize({ occurredAt, jobs: [projectedShell], attention: [] }));
    expect(unchanged).toEqual([]);
    expect(await runWithTenant(scope, () => store.headSequence())).toBe(first[0].sequence);
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${workspaceId}`));
  });
});
