import { describe, expect, it } from "vitest";
import { deriveEligibleObservations } from "@/lib/residentAutonomy/microReflection";

const scope = { workspaceId: "w", brandId: "b" };
describe("post-job micro reflection", () => {
  it("projects verified effect facts and derives a stable deduplication identity", () => {
    const event = { type: "verification_recorded", ...scope, sourceRecordId: "verification-1", observedAt: "2026-08-27T08:00:00.000Z", provenance: "verified_live", authorized: true, verified: true, outcome: "applied", latencyMs: 850, costUsd: 0.012 } as const;
    const first = deriveEligibleObservations(event); const second = deriveEligibleObservations(event);
    expect(first).toEqual(second); expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ observationType: "verified_effect", sourceRecordId: "verification-1", facts: { outcome: "applied", latencyMs: 850, costUsd: 0.012 } });
    expect(first[0].id).toMatch(/^[a-f0-9]{64}$/);
  });
  it("records bounded approval, failure, and engagement facts", () => {
    expect(deriveEligibleObservations({ type: "proposal_decided", ...scope, sourceRecordId: "decision-1", observedAt: "2026-08-27T08:00:00.000Z", provenance: "verified_live", authorized: true, verified: true, decision: "rejected", contentFormat: "short_video" })).toHaveLength(1);
    expect(deriveEligibleObservations({ type: "job_failed", ...scope, sourceRecordId: "failure-1", observedAt: "2026-08-27T08:00:00.000Z", provenance: "verified_live", authorized: true, verified: true, failureCategory: "provider_permanent", latencyMs: 5000, costUsd: 0.02 })).toHaveLength(1);
    expect(deriveEligibleObservations({ type: "engagement_measured", ...scope, sourceRecordId: "engagement-1", observedAt: "2026-08-27T08:00:00.000Z", provenance: "verified_live", authorized: true, verified: true, measurementWindowClosed: true, impressions: 100, engagements: 7, contentFormat: "text", postingHour: 9 })).toHaveLength(1);
  });
  it("excludes replay, fixtures, unverified outcomes, and immature engagement", () => {
    const base = { type: "job_completed", ...scope, sourceRecordId: "job-1", observedAt: "2026-08-27T08:00:00.000Z", authorized: true, verified: true, latencyMs: 1000, costUsd: 0.01 } as const;
    expect(deriveEligibleObservations({ ...base, provenance: "recorded_replay" })).toEqual([]);
    expect(deriveEligibleObservations({ ...base, provenance: "fixture" })).toEqual([]);
    expect(deriveEligibleObservations({ ...base, provenance: "verified_live", verified: false })).toEqual([]);
    expect(deriveEligibleObservations({ type: "engagement_measured", ...scope, sourceRecordId: "e", observedAt: base.observedAt, provenance: "verified_live", authorized: true, verified: true, measurementWindowClosed: false, impressions: 5, engagements: 1, contentFormat: "text", postingHour: 9 })).toEqual([]);
  });
  it("rejects arbitrary logs and raw prompt fields instead of silently storing them", () => {
    expect(() => deriveEligibleObservations({ type: "job_completed", ...scope, sourceRecordId: "job-1", observedAt: "2026-08-27T08:00:00.000Z", provenance: "verified_live", authorized: true, verified: true, latencyMs: 1, costUsd: 0, rawPrompt: "private" })).toThrow();
  });
});
