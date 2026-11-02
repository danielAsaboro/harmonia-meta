import { describe, expect, it } from "vitest";
import { autonomyCycleSchema, experimentSchema, configurationRevisionSchema } from "@/lib/residentAutonomy/contracts";

const scope = { workspaceId: "workspace-1", brandId: "brand-1" };
describe("resident autonomy contracts", () => {
  it("rejects unknown fields and invalid cycle state", () => {
    const cycle = { id: "cycle-1", ...scope, type: "heartbeat", state: "scheduled", scheduledAt: "2026-08-27T08:00:00.000Z", timezone: "Africa/Lagos", triggerReason: "scheduler", cycleVersion: "1.0.0", effectBearing: false, armsAttempted: [], evidenceRefs: [], modelUsageIds: [], estimatedCostUsd: 0, outcome: "pending", nextScheduledWake: "2026-08-27T09:00:00.000Z" };
    expect(autonomyCycleSchema.parse(cycle)).toEqual(cycle);
    expect(() => autonomyCycleSchema.parse({ ...cycle, state: "invented" })).toThrow();
    expect(() => autonomyCycleSchema.parse({ ...cycle, secret: "unexpected" })).toThrow();
  });

  it("allows exactly one bounded variable per immutable experiment", () => {
    const experiment = { id: "exp-1", ...scope, hypothesisId: "hyp-1", variable: "retry_backoff_seconds", baseline: 30, candidate: 45, lowerBound: 15, upperBound: 120, evidenceThreshold: 10, evaluationMethod: "before_after", successCriteria: "verified failure rate decreases", failureCriteria: "failure rate increases", maximumCostUsd: 1, startsAt: "2026-08-27T08:00:00.000Z", endsAt: "2026-09-03T08:00:00.000Z", expiresAt: "2026-09-04T08:00:00.000Z", rollbackCondition: "verified failure rate exceeds baseline", state: "candidate" };
    expect(experimentSchema.parse(experiment)).toEqual(experiment);
    expect(() => experimentSchema.parse({ ...experiment, variables: ["x", "y"] })).toThrow();
  });

  it("requires every applied configuration revision to point backward", () => {
    const revision = { id: "rev-2", ...scope, category: "retry_backoff_seconds", previousValue: 30, newValue: 45, evidenceRefs: ["obs-1"], confidence: 0.9, policyResult: "approved", traceId: "a".repeat(32), createdAt: "2026-08-27T08:00:00.000Z", state: "applied" };
    expect(() => configurationRevisionSchema.parse(revision)).toThrow(/rollback/i);
    expect(configurationRevisionSchema.parse({ ...revision, rollbackRevisionId: "rev-1" }).rollbackRevisionId).toBe("rev-1");
  });
});
