import { describe, expect, it } from "vitest";
import { eligibleEvolutionEvidence, validateAutoTuneCandidate } from "@/lib/residentAutonomy/policy";

const live = { id: "obs-1", workspaceId: "w", brandId: "b", sourceRecordId: "receipt-1", observationType: "verified_effect", provenance: "verified_live", verified: true, authorized: true, observedAt: "2026-08-27T08:00:00.000Z", facts: { outcome: "applied" } } as const;
describe("resident autonomy deterministic policy", () => {
  it("accepts only authorized verified live evolutionary evidence", () => {
    expect(eligibleEvolutionEvidence(live)).toBe(true);
    for (const provenance of ["fixture", "recorded_replay", "mock", "synthetic", "unverified"] as const) expect(eligibleEvolutionEvidence({ ...live, provenance })).toBe(false);
    expect(eligibleEvolutionEvidence({ ...live, verified: false })).toBe(false);
    expect(eligibleEvolutionEvidence({ ...live, authorized: false })).toBe(false);
  });

  it("permits reversible tuning only inside hard bounds", () => {
    expect(validateAutoTuneCandidate({ category: "retry_backoff_seconds", currentValue: 30, candidateValue: 45 })).toEqual({ decision: "auto_tune" });
    expect(validateAutoTuneCandidate({ category: "retry_backoff_seconds", currentValue: 30, candidateValue: 500 })).toMatchObject({ decision: "reject" });
    expect(validateAutoTuneCandidate({ category: "model_selection", currentValue: "gemini-3.5-flash", candidateValue: "other" })).toMatchObject({ decision: "propose" });
    expect(validateAutoTuneCandidate({ category: "budget", currentValue: 1, candidateValue: 2 })).toMatchObject({ decision: "propose" });
  });
});
