import { describe, expect, it } from "vitest";

import { planRecovery, type RecoveryCandidate } from "@/lib/recovery";

const now = "2026-08-28T12:00:00.000Z";

function candidate(changes: Partial<RecoveryCandidate>): RecoveryCandidate {
  return {
    id: "candidate-1", kind: "operation", workspaceId: "workspace-1", brandId: "brand-1",
    jobId: "job-1", state: "claimed", retryCount: 1, estimatedCostUsd: "0.000000",
    leaseExpiresAt: "2026-08-28T11:59:00.000Z", replayPolicy: "safe",
    ...changes,
  };
}

describe("bounded deterministic recovery planner", () => {
  it("classifies replay, reconciliation, operator attention, requeue, verification, and artifact blocks", () => {
    const plan = planRecovery([
      candidate({ id: "safe", replayPolicy: "safe" }),
      candidate({ id: "reconcile", replayPolicy: "reconcile" }),
      candidate({ id: "never", replayPolicy: "never" }),
      candidate({ id: "inbox", kind: "event_inbox", replayPolicy: "safe" }),
      candidate({ id: "outbox", kind: "stage_outbox", replayPolicy: "safe" }),
      candidate({ id: "effect", kind: "effect", state: "dispatched", replayPolicy: "reconcile" }),
      candidate({ id: "observed", kind: "effect", state: "observed", replayPolicy: "reconcile" }),
      candidate({ id: "receipt", kind: "receipt", state: "unverified", replayPolicy: "safe" }),
      candidate({ id: "artifact", kind: "artifact", state: "digest_invalid", replayPolicy: "never" }),
    ], { now, deadline: "2026-08-28T12:01:00.000Z", maxActions: 20, maxRetries: 3, maxCostUsd: "1.000000" });
    expect(Object.fromEntries(plan.actions.map((item) => [item.candidateId, item.action]))).toEqual({
      safe: "replay_operation", reconcile: "reconcile_operation", never: "operator_required",
      inbox: "requeue_event", outbox: "requeue_outbox", effect: "reconcile_effect",
      observed: "finalize_observed_effect", receipt: "enqueue_verification", artifact: "blocked_artifact",
    });
    expect(plan.actions.every((item) => String(item.action) !== "execute_effect")).toBe(true);
  });

  it("enforces deadline, retry, cost, and page bounds deterministically", () => {
    expect(() => planRecovery([], {
      now, deadline: now, maxActions: 10, maxRetries: 3, maxCostUsd: "1.000000",
    })).toThrow("deadline");
    expect(() => planRecovery([], {
      now, deadline: "2026-08-28T12:01:00.000Z", maxActions: 101, maxRetries: 3, maxCostUsd: "1.000000",
    })).toThrow("maxActions");
    const plan = planRecovery([
      candidate({ id: "b", retryCount: 4 }),
      candidate({ id: "a", estimatedCostUsd: "0.750000" }),
      candidate({ id: "c", estimatedCostUsd: "0.750000" }),
    ], { now, deadline: "2026-08-28T12:01:00.000Z", maxActions: 10, maxRetries: 3, maxCostUsd: "1.000000" });
    expect(plan.actions.map((item) => [item.candidateId, item.action])).toEqual([
      ["a", "replay_operation"], ["b", "operator_required"], ["c", "deferred_budget"],
    ]);
    expect(plan.estimatedCostUsd).toBe("0.750000");
  });
});
