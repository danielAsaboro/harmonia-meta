import { describe, expect, it } from "vitest";

import {
  claimWorkItem,
  deterministicWorkItemId,
  finalizeWorkItem,
  selectDispatchableItems,
  type DataWorkItem,
} from "@/lib/dataPlane/workItems";

const now = "2026-08-31T00:00:00.000Z";

function item(changes: Partial<DataWorkItem> = {}): DataWorkItem {
  return {
    id: "item-1",
    workspaceId: "workspace-1",
    brandId: "brand-1",
    batchId: "batch-1",
    partitionIndex: 0,
    sourceDigest: "a".repeat(64),
    processorVersion: "analysis-v1",
    state: "pending",
    attempt: 0,
    maxAttempts: 3,
    epoch: 0,
    artifactIds: [],
    createdAt: now,
    updatedAt: now,
    ...changes,
  };
}

describe("data-plane work items", () => {
  it("derives stable identities from batch, source, partition, and processor version", () => {
    const first = deterministicWorkItemId({ batchId: "batch-1", sourceDigest: "a".repeat(64), partitionIndex: 7, processorVersion: "analysis-v1" });
    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(deterministicWorkItemId({ batchId: "batch-1", sourceDigest: "a".repeat(64), partitionIndex: 7, processorVersion: "analysis-v1" })).toBe(first);
    expect(deterministicWorkItemId({ batchId: "batch-1", sourceDigest: "a".repeat(64), partitionIndex: 7, processorVersion: "analysis-v2" })).not.toBe(first);
  });

  it("uses leases, epochs, and attempt budgets to fence execution", () => {
    const claimed = claimWorkItem(item(), {
      ownerId: "worker-1", ownerTokenDigest: "b".repeat(64), now,
      leaseExpiresAt: "2026-08-31T00:05:00.000Z",
    });
    expect(claimed).toMatchObject({ outcome: "execute", item: { state: "claimed", attempt: 1, epoch: 1 } });
    expect(claimWorkItem(claimed.item, {
      ownerId: "worker-2", ownerTokenDigest: "c".repeat(64), now: "2026-08-31T00:01:00.000Z",
      leaseExpiresAt: "2026-08-31T00:06:00.000Z",
    }).outcome).toBe("in_progress");

    const succeeded = finalizeWorkItem(claimed.item, {
      epoch: 1, ownerTokenDigest: "b".repeat(64), outcome: "succeeded",
      artifactIds: ["artifact-1"], now: "2026-08-31T00:02:00.000Z",
    });
    expect(succeeded).toMatchObject({ state: "succeeded", artifactIds: ["artifact-1"] });
    expect(() => finalizeWorkItem(claimed.item, {
      epoch: 2, ownerTokenDigest: "b".repeat(64), outcome: "succeeded", artifactIds: [], now,
    })).toThrow("epoch");
  });

  it("dead-letters an exhausted item instead of retrying forever", () => {
    const exhausted = item({
      state: "failed", attempt: 3, failureCode: "provider_unavailable",
    });
    expect(claimWorkItem(exhausted, {
      ownerId: "worker-2", ownerTokenDigest: "c".repeat(64), now,
      leaseExpiresAt: "2026-08-31T00:05:00.000Z",
    })).toMatchObject({ outcome: "dead_lettered", item: { state: "dead_lettered" } });
  });

  it("selects deterministic work without exceeding active concurrency", () => {
    const items = [
      item({ id: "item-2", partitionIndex: 2 }),
      item({ id: "item-0", partitionIndex: 0 }),
      item({ id: "item-active", partitionIndex: 1, state: "claimed", leaseExpiresAt: "2026-08-31T00:05:00.000Z" }),
      item({ id: "item-3", partitionIndex: 3 }),
    ];
    expect(selectDispatchableItems(items, { now, maxInFlight: 2 })).toEqual([items[1]]);
  });

  it("uses a dispatch visibility window to avoid flooding duplicate Pub/Sub messages", () => {
    expect(selectDispatchableItems([
      item({ lastDispatchedAt: "2026-08-30T23:59:30.000Z", dispatchCount: 1 }),
    ], { now, maxInFlight: 2 })).toEqual([]);
    expect(selectDispatchableItems([
      item({ lastDispatchedAt: "2026-08-30T23:58:00.000Z", dispatchCount: 1 }),
    ], { now, maxInFlight: 2 })).toHaveLength(1);
  });
});
