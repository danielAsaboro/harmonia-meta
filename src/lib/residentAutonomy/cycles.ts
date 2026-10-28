import { createHash } from "node:crypto";
import { autonomyCycleSchema, type AutonomyCycle } from "./contracts";

export function cycleIdentity(scope: { workspaceId: string; brandId: string }, type: AutonomyCycle["type"], scheduledWindow: string): string {
  return createHash("sha256").update(`${scope.workspaceId}\n${scope.brandId}\n${type}\n${new Date(scheduledWindow).toISOString()}`, "utf8").digest("hex");
}

export type CycleClaim = { ownerId: string; claimToken: string; now: string; leaseExpiresAt: string };
export type CycleClaimResult = { outcome: "execute"; cycle: AutonomyCycle } | { outcome: "in_progress" | "already_completed" | "uncertain"; cycle: AutonomyCycle };
export function claimCycle(input: AutonomyCycle, claim: CycleClaim): CycleClaimResult {
  const cycle = autonomyCycleSchema.parse(input); const now = Date.parse(claim.now);
  if (!Number.isFinite(now) || Date.parse(claim.leaseExpiresAt) <= now) throw new Error("cycle claim lease must expire after claim time");
  if (["completed", "partially_completed", "failed"].includes(cycle.state)) return { outcome: "already_completed", cycle };
  if (cycle.state === "uncertain") return { outcome: "uncertain", cycle };
  if ((cycle.state === "claimed" || cycle.state === "running") && cycle.leaseExpiresAt && Date.parse(cycle.leaseExpiresAt) > now) return { outcome: "in_progress", cycle };
  if ((cycle.state === "claimed" || cycle.state === "running") && cycle.effectBearing) return { outcome: "uncertain", cycle: { ...cycle, state: "uncertain", finishedAt: claim.now, outcome: "effect-bearing cycle lease expired before finalization" } };
  const claimed: AutonomyCycle = { ...cycle, state: "claimed", startedAt: cycle.startedAt ?? claim.now, leaseOwner: claim.ownerId, leaseTokenDigest: createHash("sha256").update(claim.claimToken).digest("hex"), leaseExpiresAt: claim.leaseExpiresAt, outcome: "claimed" };
  return { outcome: "execute", cycle: autonomyCycleSchema.parse(claimed) };
}

const transitions: Record<AutonomyCycle["state"], ReadonlySet<AutonomyCycle["state"]>> = {
  scheduled: new Set(["claimed"]), claimed: new Set(["running", "failed", "uncertain"]),
  running: new Set(["completed", "partially_completed", "failed", "uncertain"]),
  completed: new Set(), partially_completed: new Set(), failed: new Set(), uncertain: new Set(),
};
export function transitionCycle(cycleInput: AutonomyCycle, input: { state: AutonomyCycle["state"]; at: string; claimToken: string; outcome: string }): AutonomyCycle {
  const cycle = autonomyCycleSchema.parse(cycleInput);
  if (!transitions[cycle.state].has(input.state)) throw new Error(`invalid cycle transition: ${cycle.state} -> ${input.state}`);
  const digest = createHash("sha256").update(input.claimToken).digest("hex");
  if (!cycle.leaseTokenDigest || cycle.leaseTokenDigest !== digest) throw new Error("cycle lease token mismatch");
  const terminal = ["completed", "partially_completed", "failed", "uncertain"].includes(input.state);
  return autonomyCycleSchema.parse({ ...cycle, state: input.state, outcome: input.outcome, ...(terminal ? { finishedAt: input.at } : {}) });
}

export function recoverableMissedCycles(cycles: AutonomyCycle[], now: Date, policy: { heartbeatMaxAgeMs: number; wakeupMaxAgeMs: number }): AutonomyCycle[] {
  const recovered = new Set(cycles.map((cycle) => cycle.recoveryOfCycleId).filter(Boolean));
  return cycles.filter((cycle) => {
    if (cycle.state !== "scheduled" || cycle.recoveryOfCycleId || recovered.has(cycle.id)) return false;
    const age = now.getTime() - Date.parse(cycle.scheduledAt); if (age <= 0) return false;
    const maxAge = cycle.type === "wakeup_call" ? policy.wakeupMaxAgeMs : cycle.type === "heartbeat" ? policy.heartbeatMaxAgeMs : 0;
    return maxAge > 0 && age <= maxAge;
  });
}
