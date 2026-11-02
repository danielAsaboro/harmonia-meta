import { afterAll, describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import {
  claimDurableOperation,
  createDurableOperation,
  db,
  finalizeDurableOperation,
  getDurableOperation,
} from "@/lib/firestore";
import { operationIdForStage } from "@/lib/operations";
import { runWithTenant } from "@/lib/tenancy";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const workspaceId = `operation-test-${Date.now()}`;
const scope = {
  workspaceId,
  brandId: "brand-test",
  principal: servicePrincipal("operation-integration"),
};
const operationId = operationIdForStage("job-1", "understand");

describe.skipIf(!emulator)("durable operation Firestore transactions", () => {
  it("grants one concurrent claim, increments reclaim epochs, and rejects stale finalization", async () => {
    await runWithTenant(scope, () => createDurableOperation({
      id: operationId,
      workspaceId,
      brandId: scope.brandId,
      jobId: "job-1",
      kind: "stage",
      goal: { type: "run_stage", version: 1, digest: "a".repeat(64), acceptance: ["persist result"] },
      correlationId: "job:job-1",
      replayPolicy: "safe",
      maxAttempts: 3,
      now: "2026-08-28T12:00:00.000Z",
    }));

    const outcomes = await runWithTenant(scope, () => Promise.all([
      claimDurableOperation(operationId, {
        ownerId: "worker-a", ownerTokenDigest: "b".repeat(64),
        now: "2026-08-28T12:00:00.000Z", leaseExpiresAt: "2026-08-28T12:01:00.000Z",
      }),
      claimDurableOperation(operationId, {
        ownerId: "worker-b", ownerTokenDigest: "c".repeat(64),
        now: "2026-08-28T12:00:00.000Z", leaseExpiresAt: "2026-08-28T12:01:00.000Z",
      }),
    ]));
    expect(outcomes.map((result) => result.outcome).sort()).toEqual(["execute", "in_progress"]);

    const reclaimed = await runWithTenant(scope, () => claimDurableOperation(operationId, {
      ownerId: "worker-c", ownerTokenDigest: "d".repeat(64),
      now: "2026-08-28T12:02:00.000Z", leaseExpiresAt: "2026-08-28T12:07:00.000Z",
    }));
    expect(reclaimed).toMatchObject({ outcome: "execute", operation: { epoch: 2 } });

    await expect(runWithTenant(scope, () => finalizeDurableOperation(operationId, {
      epoch: 1, state: "succeeded", now: "2026-08-28T12:03:00.000Z",
    }))).rejects.toThrow("operation epoch mismatch");

    await runWithTenant(scope, () => finalizeDurableOperation(operationId, {
      epoch: 2, state: "succeeded", now: "2026-08-28T12:03:00.000Z",
    }));
    await expect(runWithTenant({ ...scope, workspaceId: "other-workspace" }, () => getDurableOperation(operationId)))
      .resolves.toBeNull();
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${workspaceId}`));
  });
});
