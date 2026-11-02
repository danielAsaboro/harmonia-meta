import { describe, expect, it } from "vitest";

import {
  OperationStore,
  operationDocumentPath,
  type OperationPersistence,
  type OperationPersistenceTransaction,
} from "@/lib/operationStore";
import { createOperation, operationIdForStage, type OperationRecord } from "@/lib/operations";
import { servicePrincipal } from "@/lib/authority";
import { runWithTenant } from "@/lib/tenancy";

const scope = {
  workspaceId: "workspace-1",
  brandId: "brand-1",
  principal: servicePrincipal("operation-store-test"),
};

class MemoryPersistence implements OperationPersistence {
  readonly records = new Map<string, OperationRecord>();

  async transact<T>(work: (tx: OperationPersistenceTransaction) => Promise<T>): Promise<T> {
    const staged = new Map(this.records);
    const tx: OperationPersistenceTransaction = {
      get: async (path) => staged.get(path) ?? null,
      create: (path, operation) => {
        if (staged.has(path)) throw new Error("document already exists");
        staged.set(path, structuredClone(operation));
      },
      set: (path, operation) => staged.set(path, structuredClone(operation)),
    };
    const result = await work(tx);
    this.records.clear();
    for (const [key, value] of staged) this.records.set(key, value);
    return result;
  }

  async get(path: string): Promise<OperationRecord | null> {
    return this.records.get(path) ?? null;
  }

  async listExpired(
    collectionPath: string,
    now: string,
    limit: number,
    cursor?: { leaseExpiresAt: string; id: string },
  ): Promise<OperationRecord[]> {
    return [...this.records.entries()]
      .filter(([path, operation]) => path.startsWith(`${collectionPath}/`)
        && operation.state === "claimed"
        && Boolean(operation.leaseExpiresAt)
        && operation.leaseExpiresAt! <= now)
      .map(([, operation]) => operation)
      .sort((a, b) => `${a.leaseExpiresAt}:${a.id}`.localeCompare(`${b.leaseExpiresAt}:${b.id}`))
      .filter((operation) => !cursor
        || `${operation.leaseExpiresAt}:${operation.id}` > `${cursor.leaseExpiresAt}:${cursor.id}`)
      .slice(0, limit);
  }
}

function input(now = "2026-08-28T12:00:00.000Z") {
  return {
    id: operationIdForStage("job-1", "understand"),
    workspaceId: scope.workspaceId,
    brandId: scope.brandId,
    jobId: "job-1",
    kind: "stage" as const,
    goal: { type: "run_stage", version: 1, digest: "a".repeat(64), acceptance: ["persist result"] },
    correlationId: "job:job-1",
    replayPolicy: "safe" as const,
    maxAttempts: 3,
    now,
  };
}

describe("operation repository", () => {
  it("uses a tenant collection while retaining the stable domain ID", () => {
    expect(operationDocumentPath(scope, operationIdForStage("job-1", "understand")))
      .toBe("workspaces/workspace-1/operations/job:job-1:stage:understand");
    expect(() => operationDocumentPath(scope, "../../other")).toThrow("invalid operation document id");
  });

  it("creates a deterministic record idempotently and rejects identity conflicts", async () => {
    const store = new OperationStore(new MemoryPersistence());
    const first = await runWithTenant(scope, () => store.create(input()));
    const duplicate = await runWithTenant(scope, () => store.create(input("2026-08-28T12:01:00.000Z")));
    expect(first.created).toBe(true);
    expect(duplicate).toEqual({ created: false, operation: first.operation });

    await expect(runWithTenant(scope, () => store.create({
      ...input(),
      goal: { ...input().goal, digest: "b".repeat(64) },
    }))).rejects.toThrow("operation identity conflict");
  });

  it("claims, fences, finalizes, and rejects stale epochs", async () => {
    const store = new OperationStore(new MemoryPersistence());
    const created = await runWithTenant(scope, () => store.create(input()));
    const claim = await runWithTenant(scope, () => store.claim(created.operation.id, {
      ownerId: "worker-a",
      ownerTokenDigest: "b".repeat(64),
      now: "2026-08-28T12:00:00.000Z",
      leaseExpiresAt: "2026-08-28T12:05:00.000Z",
    }));
    expect(claim).toMatchObject({ outcome: "execute", operation: { epoch: 1 } });

    await expect(runWithTenant(scope, () => store.assertFence({
      operationId: created.operation.id,
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      epoch: 0,
      now: "2026-08-28T12:01:00.000Z",
    }))).rejects.toThrow("operation epoch mismatch");

    const done = await runWithTenant(scope, () => store.finalize(created.operation.id, {
      epoch: 1,
      state: "succeeded",
      now: "2026-08-28T12:01:00.000Z",
    }));
    expect(done.state).toBe("succeeded");
  });

  it("rejects finalization after lease expiry even before another owner reclaims", async () => {
    const store = new OperationStore(new MemoryPersistence());
    const created = await runWithTenant(scope, () => store.create(input()));
    await runWithTenant(scope, () => store.claim(created.operation.id, {
      ownerId: "worker-a",
      ownerTokenDigest: "b".repeat(64),
      now: "2026-08-28T12:00:00.000Z",
      leaseExpiresAt: "2026-08-28T12:01:00.000Z",
    }));
    await expect(runWithTenant(scope, () => store.finalize(created.operation.id, {
      epoch: 1,
      state: "succeeded",
      now: "2026-08-28T12:02:00.000Z",
    }))).rejects.toThrow("operation lease expired");
  });

  it("refuses records outside the current tenant", async () => {
    const store = new OperationStore(new MemoryPersistence());
    await expect(runWithTenant(scope, () => store.create({
      ...input(),
      workspaceId: "other-workspace",
    }))).rejects.toThrow("operation tenant mismatch");
  });

  it("pages only expired claimed records in deterministic order", async () => {
    const persistence = new MemoryPersistence();
    const store = new OperationStore(persistence);
    const base = createOperation(input());
    const records = [
      { ...base, id: operationIdForStage("job-1", "a"), state: "claimed" as const, leaseExpiresAt: "2026-08-28T12:01:00.000Z" },
      { ...base, id: operationIdForStage("job-1", "b"), state: "claimed" as const, leaseExpiresAt: "2026-08-28T12:02:00.000Z" },
      { ...base, id: operationIdForStage("job-1", "c"), state: "claimed" as const, leaseExpiresAt: "2026-08-28T12:10:00.000Z" },
    ];
    for (const record of records) {
      persistence.records.set(operationDocumentPath(scope, record.id), record);
    }

    const page = await runWithTenant(scope, () => store.listRecoveryCandidates({
      now: "2026-08-28T12:05:00.000Z",
      limit: 1,
    }));
    expect(page.items.map((item) => item.id)).toEqual([operationIdForStage("job-1", "a")]);
    expect(page.nextCursor).toEqual({
      leaseExpiresAt: "2026-08-28T12:01:00.000Z",
      id: operationIdForStage("job-1", "a"),
    });
  });
});
