import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { claimCycle, cycleIdentity, recoverableMissedCycles, transitionCycle } from "@/lib/residentAutonomy/cycles";
import type { AutonomyCycle } from "@/lib/residentAutonomy/contracts";

const scheduled = (overrides: Partial<AutonomyCycle> = {}): AutonomyCycle => ({ id: "cycle", workspaceId: "w", brandId: "b", type: "heartbeat", state: "scheduled", scheduledAt: "2026-08-27T08:00:00.000Z", timezone: "Africa/Lagos", triggerReason: "scheduler", cycleVersion: "1.0.0", effectBearing: false, armsAttempted: [], evidenceRefs: [], modelUsageIds: [], estimatedCostUsd: 0, outcome: "pending", nextScheduledWake: "2026-08-27T09:00:00.000Z", ...overrides });

describe("resident autonomy cycle state machine", () => {
  it("derives tenant and window scoped stable identities", () => {
    const first = cycleIdentity({ workspaceId: "w", brandId: "b" }, "heartbeat", "2026-08-27T08:00:00.000Z");
    expect(first).toMatch(/^[a-f0-9]{64}$/); expect(first).toBe(cycleIdentity({ workspaceId: "w", brandId: "b" }, "heartbeat", "2026-08-27T08:00:00.000Z"));
    expect(first).not.toBe(cycleIdentity({ workspaceId: "other", brandId: "b" }, "heartbeat", "2026-08-27T08:00:00.000Z"));
  });

  it("suppresses active duplicates and claims a scheduled cycle once", () => {
    const claim = { ownerId: "worker-1", claimToken: "secret-token", now: "2026-08-27T08:00:01.000Z", leaseExpiresAt: "2026-08-27T08:05:01.000Z" };
    const result = claimCycle(scheduled(), claim); expect(result.outcome).toBe("execute");
    if (result.outcome !== "execute") throw new Error("expected claim");
    expect(result.cycle).toMatchObject({ state: "claimed", leaseOwner: "worker-1", leaseTokenDigest: createHash("sha256").update("secret-token").digest("hex") });
    expect(claimCycle(result.cycle, { ...claim, ownerId: "worker-2" }).outcome).toBe("in_progress");
  });

  it("recovers expired deterministic work but fails effect-bearing expiry closed", () => {
    const expired = scheduled({ state: "claimed", leaseOwner: "old", leaseTokenDigest: "a".repeat(64), leaseExpiresAt: "2026-08-27T08:01:00.000Z" });
    expect(claimCycle(expired, { ownerId: "new", claimToken: "new-token", now: "2026-08-27T08:02:00.000Z", leaseExpiresAt: "2026-08-27T08:07:00.000Z" }).outcome).toBe("execute");
    expect(claimCycle({ ...expired, effectBearing: true }, { ownerId: "new", claimToken: "new-token", now: "2026-08-27T08:02:00.000Z", leaseExpiresAt: "2026-08-27T08:07:00.000Z" }).outcome).toBe("uncertain");
  });

  it("enforces legal transitions and matching lease tokens", () => {
    const claimed = claimCycle(scheduled(), { ownerId: "worker", claimToken: "token", now: "2026-08-27T08:00:01.000Z", leaseExpiresAt: "2026-08-27T08:05:01.000Z" });
    if (claimed.outcome !== "execute") throw new Error("expected claim");
    const running = transitionCycle(claimed.cycle, { state: "running", at: "2026-08-27T08:00:02.000Z", claimToken: "token", outcome: "running" });
    expect(() => transitionCycle(running, { state: "completed", at: "2026-08-27T08:01:00.000Z", claimToken: "wrong", outcome: "done" })).toThrow(/token/i);
    expect(transitionCycle(running, { state: "completed", at: "2026-08-27T08:01:00.000Z", claimToken: "token", outcome: "done" }).state).toBe("completed");
    expect(() => transitionCycle(scheduled(), { state: "completed", at: "2026-08-27T08:01:00.000Z", claimToken: "token", outcome: "done" })).toThrow(/transition/i);
  });

  it("recovers useful missed cycles once and expires stale wakeup calls", () => {
    const cycles = [scheduled({ id: "h", scheduledAt: "2026-08-27T07:00:00.000Z" }), scheduled({ id: "wake-old", type: "wakeup_call", scheduledAt: "2026-08-26T06:00:00.000Z" }), scheduled({ id: "recovered", recoveryOfCycleId: "source", recoveredAt: "2026-08-27T07:30:00.000Z" })];
    expect(recoverableMissedCycles(cycles, new Date("2026-08-27T08:00:00.000Z"), { heartbeatMaxAgeMs: 2 * 60 * 60 * 1000, wakeupMaxAgeMs: 4 * 60 * 60 * 1000 }).map((cycle) => cycle.id)).toEqual(["h"]);
  });
});
