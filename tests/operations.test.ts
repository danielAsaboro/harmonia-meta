import { describe, expect, it } from "vitest";

import {
  assertOperationFence,
  claimOperation,
  createOperation,
  finalizeOperation,
  operationIdForEffect,
  operationIdForStage,
  type OperationRecord,
} from "@/lib/operations";

const NOW = "2026-08-28T12:00:00.000Z";
const LATER = "2026-08-28T12:05:00.000Z";

function operation(overrides: Partial<OperationRecord> = {}): OperationRecord {
  return createOperation({
    id: operationIdForStage("job-1", "understand"),
    workspaceId: "workspace-1",
    brandId: "brand-1",
    jobId: "job-1",
    kind: "stage",
    goal: {
      type: "run_stage",
      version: 1,
      digest: "a".repeat(64),
      acceptance: ["analysis is persisted"],
    },
    correlationId: "job:job-1",
    replayPolicy: "safe",
    maxAttempts: 3,
    now: NOW,
    ...overrides,
  });
}

describe("durable operation identities", () => {
  it("derives stable domain IDs without delivery or worker identity", () => {
    expect(operationIdForStage("job-1", "understand")).toBe("job:job-1:stage:understand");
    expect(operationIdForEffect("job-1", "command-7")).toBe("job:job-1:effect:command-7");
  });

  it("rejects identity segments that could alias the canonical separator", () => {
    expect(() => operationIdForStage("job:other", "understand")).toThrow("invalid operation identity segment");
  });
});

describe("operation claims", () => {
  it("constructs a runnable operation and grants epoch one to its first owner", () => {
    const initial = operation();
    expect(initial).toMatchObject({ state: "runnable", epoch: 0, attempt: 0 });

    const result = claimOperation(initial, {
      ownerId: "worker-a",
      ownerTokenDigest: "b".repeat(64),
      now: NOW,
      leaseExpiresAt: LATER,
    });

    expect(result.outcome).toBe("execute");
    expect(result.operation).toMatchObject({
      state: "claimed",
      ownerId: "worker-a",
      epoch: 1,
      attempt: 1,
      leaseExpiresAt: LATER,
    });
    expect(initial).toMatchObject({ state: "runnable", epoch: 0, attempt: 0 });
  });

  it("does not steal an active lease", () => {
    const claimed = claimOperation(operation(), {
      ownerId: "worker-a",
      ownerTokenDigest: "b".repeat(64),
      now: NOW,
      leaseExpiresAt: LATER,
    }).operation;

    const result = claimOperation(claimed, {
      ownerId: "worker-b",
      ownerTokenDigest: "c".repeat(64),
      now: "2026-08-28T12:01:00.000Z",
      leaseExpiresAt: "2026-08-28T12:06:00.000Z",
    });

    expect(result.outcome).toBe("in_progress");
    expect(result.operation).toEqual(claimed);
  });

  it("reclaims expired safe work with a strictly newer epoch", () => {
    const claimed = claimOperation(operation(), {
      ownerId: "worker-a",
      ownerTokenDigest: "b".repeat(64),
      now: NOW,
      leaseExpiresAt: "2026-08-28T12:01:00.000Z",
    }).operation;

    const result = claimOperation(claimed, {
      ownerId: "worker-b",
      ownerTokenDigest: "c".repeat(64),
      now: "2026-08-28T12:02:00.000Z",
      leaseExpiresAt: "2026-08-28T12:07:00.000Z",
    });

    expect(result.outcome).toBe("execute");
    expect(result.operation).toMatchObject({ ownerId: "worker-b", epoch: 2, attempt: 2 });
  });

  it.each(["reconcile", "never"] as const)(
    "surfaces expired %s work as unknown rather than replaying it",
    (replayPolicy) => {
      const claimed = claimOperation(operation({ replayPolicy }), {
        ownerId: "worker-a",
        ownerTokenDigest: "b".repeat(64),
        now: NOW,
        leaseExpiresAt: "2026-08-28T12:01:00.000Z",
      }).operation;

      const result = claimOperation(claimed, {
        ownerId: "worker-b",
        ownerTokenDigest: "c".repeat(64),
        now: "2026-08-28T12:02:00.000Z",
        leaseExpiresAt: "2026-08-28T12:07:00.000Z",
      });

      expect(result.outcome).toBe("unknown");
      expect(result.operation).toMatchObject({
        state: "unknown",
        epoch: 1,
        unresolvedReason: "operation lease expired under non-replayable policy",
      });
    },
  );

  it("fails closed after the attempt budget is exhausted", () => {
    const claimed = claimOperation(operation({ maxAttempts: 1 }), {
      ownerId: "worker-a",
      ownerTokenDigest: "b".repeat(64),
      now: NOW,
      leaseExpiresAt: "2026-08-28T12:01:00.000Z",
    }).operation;
    const result = claimOperation(claimed, {
      ownerId: "worker-b",
      ownerTokenDigest: "c".repeat(64),
      now: "2026-08-28T12:02:00.000Z",
      leaseExpiresAt: "2026-08-28T12:07:00.000Z",
    });

    expect(result.outcome).toBe("failed");
    expect(result.operation).toMatchObject({ state: "failed", unresolvedReason: "operation attempt budget exhausted" });
  });
});

describe("operation fencing and finalization", () => {
  const claimed = () => claimOperation(operation(), {
    ownerId: "worker-a",
    ownerTokenDigest: "b".repeat(64),
    now: NOW,
    leaseExpiresAt: LATER,
  }).operation;

  it("accepts only the current live epoch and tenant", () => {
    expect(() => assertOperationFence(claimed(), {
      operationId: "job:job-1:stage:understand",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      epoch: 1,
      now: "2026-08-28T12:01:00.000Z",
    })).not.toThrow();
  });

  it("rejects stale, expired, terminal, and cross-tenant fences", () => {
    const current = claimed();
    expect(() => assertOperationFence(current, {
      operationId: current.id,
      workspaceId: current.workspaceId,
      brandId: current.brandId,
      epoch: 0,
      now: "2026-08-28T12:01:00.000Z",
    })).toThrow("operation epoch mismatch");
    expect(() => assertOperationFence(current, {
      operationId: current.id,
      workspaceId: "other-workspace",
      brandId: current.brandId,
      epoch: 1,
      now: "2026-08-28T12:01:00.000Z",
    })).toThrow("operation tenant mismatch");
    expect(() => assertOperationFence(current, {
      operationId: current.id,
      workspaceId: current.workspaceId,
      brandId: current.brandId,
      epoch: 1,
      now: LATER,
    })).toThrow("operation lease expired");

    const done = finalizeOperation(current, {
      epoch: 1,
      state: "succeeded",
      now: "2026-08-28T12:01:00.000Z",
    });
    expect(() => assertOperationFence(done, {
      operationId: done.id,
      workspaceId: done.workspaceId,
      brandId: done.brandId,
      epoch: 1,
      now: "2026-08-28T12:02:00.000Z",
    })).toThrow("operation is succeeded");
  });

  it("finalizes only claimed work at the current epoch", () => {
    const current = claimed();
    const done = finalizeOperation(current, {
      epoch: 1,
      state: "succeeded",
      now: "2026-08-28T12:01:00.000Z",
    });
    expect(done).toMatchObject({ state: "succeeded", completedAt: "2026-08-28T12:01:00.000Z" });
    expect(() => finalizeOperation(current, {
      epoch: 0,
      state: "failed",
      now: "2026-08-28T12:01:00.000Z",
    })).toThrow("operation epoch mismatch");
    expect(() => finalizeOperation(operation(), {
      epoch: 0,
      state: "succeeded",
      now: "2026-08-28T12:01:00.000Z",
    })).toThrow("operation is runnable");
  });
});
