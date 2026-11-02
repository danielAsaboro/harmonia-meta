import { afterAll, describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import { db } from "@/lib/firestore";
import { DataPlaneRepository } from "@/lib/dataPlane/repository";
import { runWithTenant } from "@/lib/tenancy";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const workspaceId = `data-plane-test-${Date.now()}`;
const scope = { workspaceId, brandId: "brand-test", principal: servicePrincipal("data-plane-integration") };

describe.skipIf(!emulator)("data-plane Firestore fencing", () => {
  it("creates a manifest batch and fences claim finalization", async () => {
    const repository = new DataPlaneRepository(db());
    const batch = {
      id: "batch-1", workspaceId, brandId: scope.brandId,
      manifest: { uri: `gs://${workspaceId}-artifacts/manifests/batch-1.json`, sha256: "a".repeat(64), itemCount: 1, byteCount: 500 },
      processorVersion: "analysis-v1", state: "pending" as const,
      maxInFlight: 4, maxAttempts: 3, minimumSuccessRatio: 1, allowPartial: false,
      createdAt: "2026-08-31T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z",
    };
    const work = {
      id: "item-1", workspaceId, brandId: scope.brandId, batchId: batch.id,
      partitionIndex: 0, sourceDigest: "b".repeat(64), processorVersion: batch.processorVersion,
      state: "pending" as const, attempt: 0, maxAttempts: 3, epoch: 0, artifactIds: [],
      createdAt: batch.createdAt, updatedAt: batch.updatedAt,
    };
    await runWithTenant(scope, () => repository.create(batch, [work]));
    const claim = await runWithTenant(scope, () => repository.claim(batch.id, work.id, {
      ownerId: "worker-1", ownerTokenDigest: "c".repeat(64), now: "2026-08-31T00:01:00.000Z", leaseExpiresAt: "2026-08-31T00:06:00.000Z",
    }));
    expect(claim).toMatchObject({ outcome: "execute", item: { epoch: 1 } });
    await expect(runWithTenant(scope, () => repository.finalize(batch.id, work.id, {
      epoch: 1, ownerTokenDigest: "d".repeat(64), outcome: "succeeded", artifactIds: ["artifact-1"], now: "2026-08-31T00:02:00.000Z",
    }))).rejects.toThrow("owner");
    expect(await runWithTenant(scope, () => repository.finalize(batch.id, work.id, {
      epoch: 1, ownerTokenDigest: "c".repeat(64), outcome: "succeeded", artifactIds: ["artifact-1"], now: "2026-08-31T00:02:00.000Z",
    }))).toMatchObject({ state: "succeeded" });
    expect(await runWithTenant(scope, () => repository.outcome(batch.id))).toMatchObject({ outcome: "complete", counts: { total: 1, succeeded: 1 } });
  });

  it("initializes beyond one Firestore transaction limit in resumable chunks", async () => {
    const repository = new DataPlaneRepository(db());
    const createdAt = "2026-08-31T00:10:00.000Z";
    const batch = {
      id: "batch-large", workspaceId, brandId: scope.brandId,
      manifest: { uri: `gs://${workspaceId}-artifacts/manifests/batch-large.json`, sha256: "d".repeat(64), itemCount: 501, byteCount: 50_100 },
      processorVersion: "analysis-v2", state: "pending" as const, maxInFlight: 25, maxAttempts: 3,
      minimumSuccessRatio: 0.95, allowPartial: true, createdAt, updatedAt: createdAt,
    };
    const work = Array.from({ length: 501 }, (_, partitionIndex) => ({
      id: `large-${partitionIndex}`, workspaceId, brandId: scope.brandId, batchId: batch.id, partitionIndex,
      sourceDigest: "e".repeat(64), processorVersion: batch.processorVersion, state: "pending" as const,
      attempt: 0, maxAttempts: 3, epoch: 0, artifactIds: [], createdAt, updatedAt: createdAt,
    }));
    await runWithTenant(scope, () => repository.create(batch, work));
    const batchRef = db().doc(`workspaces/${workspaceId}/data_batches/${batch.id}`);
    expect((await batchRef.get()).get("state")).toBe("pending");
    expect((await batchRef.collection("work_items").count().get()).data().count).toBe(501);
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${workspaceId}`));
  });
});
