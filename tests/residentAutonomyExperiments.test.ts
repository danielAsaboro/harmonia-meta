import { describe, expect, it } from "vitest";
import { evaluateExperiment } from "@/lib/residentAutonomy/experiments";
import type { Experiment, Observation } from "@/lib/residentAutonomy/contracts";

const experiment: Experiment = { id: "exp", workspaceId: "w", brandId: "b", hypothesisId: "hyp", variable: "preferred_posting_hour", baseline: 14, candidate: 9, lowerBound: 0, upperBound: 23, evidenceThreshold: 2, evaluationMethod: "before_after", successCriteria: "verified engagement improves", failureCriteria: "verified engagement declines", maximumCostUsd: 1, startsAt: "2026-08-20T00:00:00.000Z", endsAt: "2026-08-27T00:00:00.000Z", expiresAt: "2026-08-28T00:00:00.000Z", rollbackCondition: "engagement falls below baseline", state: "evaluating" };
const observation = (id: string, engagementRate: number): Observation => ({ id, workspaceId: "w", brandId: "b", sourceRecordId: id, observationType: "measured_engagement", provenance: "verified_live", verified: true, authorized: true, observedAt: "2026-08-27T00:00:00.000Z", facts: { engagementRate } });
const evaluationNow = { now: "2026-08-27T12:00:00.000Z" };

describe("resident autonomy experiment evaluation", () => {
  it("defers when evidence is insufficient or contradictory", () => {
    expect(evaluateExperiment(experiment, [observation("one", 0.2)], { baselineMetric: 0.1, candidateMetric: 0.2, unresolvedContradictions: false, budgetAvailable: true, ...evaluationNow })).toMatchObject({ decision: "defer", reason: "insufficient_evidence" });
    expect(evaluateExperiment(experiment, [observation("one", 0.2), observation("two", 0.2)], { baselineMetric: 0.1, candidateMetric: 0.2, unresolvedContradictions: true, budgetAvailable: true, ...evaluationNow })).toMatchObject({ decision: "defer", reason: "unresolved_contradiction" });
  });
  it("promotes only a reversible bounded candidate from eligible live evidence", () => {
    expect(evaluateExperiment(experiment, [observation("one", 0.2), observation("two", 0.25)], { baselineMetric: 0.1, candidateMetric: 0.225, unresolvedContradictions: false, budgetAvailable: true, ...evaluationNow })).toMatchObject({ decision: "promote", causalConfidence: "weak_before_after" });
    expect(evaluateExperiment(experiment, [{ ...observation("one", 0.2), provenance: "recorded_replay" }, observation("two", 0.25)], { baselineMetric: 0.1, candidateMetric: 0.225, unresolvedContradictions: false, budgetAvailable: true, ...evaluationNow })).toMatchObject({ decision: "defer", reason: "insufficient_evidence" });
    expect(evaluateExperiment({ ...experiment, candidate: 30 }, [observation("one", 0.2), observation("two", 0.25)], { baselineMetric: 0.1, candidateMetric: 0.225, unresolvedContradictions: false, budgetAvailable: true, ...evaluationNow })).toMatchObject({ decision: "reject", reason: "policy_rejection" });
  });
  it("expires old experiments and pauses promotions without budget", () => {
    const evidence = [observation("one", 0.2), observation("two", 0.25)];
    expect(evaluateExperiment(experiment, evidence, { baselineMetric: 0.1, candidateMetric: 0.225, unresolvedContradictions: false, budgetAvailable: false, ...evaluationNow })).toMatchObject({ decision: "defer", reason: "budget_exhaustion" });
    expect(evaluateExperiment({ ...experiment, expiresAt: "2026-08-26T00:00:00.000Z" }, evidence, { baselineMetric: 0.1, candidateMetric: 0.225, unresolvedContradictions: false, budgetAvailable: true, now: "2026-08-27T00:00:00.000Z" })).toMatchObject({ decision: "expire" });
  });
});
