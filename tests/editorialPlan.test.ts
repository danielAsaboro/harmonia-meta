import { describe, expect, it } from "vitest";
import { assertEditorialPlanSubmission, assertSelectedProductionAuthority, editorialDraftCompletionPatch, editorialPlanDigest, editorialPlanEvidenceLineage, editorialPlanningSnapshotDigest, isMatchingActiveProduction, isMatchingCompletedProduction } from "@/lib/editorialPlan";

const snapshot = {
  snapshotId: "planning-job-1-v1", asOf: "2026-08-30T00:00:00Z",
  horizonStartAt: "2026-08-31T00:00:00Z", horizonEndAt: "2026-09-28T00:00:00Z", timezone: "UTC",
  channelCapabilities: [{ channel: "x", formats: ["text_post"] }], existingCommitments: [],
  productionCapacity: { maxItems: 8, maxItemsPerWeek: 2 }, cadenceConstraints: { minimumHoursBetweenItems: 24, maxItemsPerChannelPerWeek: 2 },
  postingWindowObservations: [], assetReadiness: [], blockedDependencies: [], calendarProjection: [],
  provenanceIds: ["policy:editorial-planning-v1"],
};
const snapshotDigest = editorialPlanningSnapshotDigest(snapshot);

const item = {
  id: "item-1", briefId: "brief-1", campaignTheme: "Proof", contentPillar: "Operations",
  objective: "Show proof", audienceId: "founders", funnelStage: "consideration" as const,
  intendedConversion: "request demo", ctaIntent: "request demo", kpi: "qualified demos",
  channel: "x", format: "text_post", evidenceRefs: ["m1", "context:campaign"],
  publicationWindowStartAt: "2026-09-01T16:00:00Z", publicationWindowEndAt: "2026-09-01T18:00:00Z",
  productionDeadlineAt: "2026-08-31T18:00:00Z", priority: 1, selectionScore: 0.9,
  dependencies: [], productionStatus: "planned" as const, constraints: [], requiredAssets: [],
  planningRationale: "Lead with proof.", selectionRationale: "Highest priority eligible item.", confidence: "high" as const,
};

const plan = {
  planId: "plan-job-1-v1", version: 1, approvedStrategyDigest: "a".repeat(64),
  planningSnapshotId: snapshot.snapshotId, planningSnapshotDigest: snapshotDigest,
  horizonStartAt: "2026-08-31T00:00:00Z", horizonEndAt: "2026-09-28T00:00:00Z", timezone: "UTC",
  summary: "Proof campaign.", sequencingRationale: "Proof first.", cadenceRationale: "One item.",
  assumptions: [], confidence: "high" as const, items: [item], selectedNextItemId: "item-1",
};

const job = {
  stage: "plan", strategyDigest: "a".repeat(64), strategyRevision: 1,
  contentStrategy: { strategyId: "strategy-job-1-v1", version: 1 },
  strategyApprovalState: "approved", strategyApproval: { decision: "approved", payloadDigest: "a".repeat(64), revision: 1 },
  editorialPlanHistory: undefined,
  editorialPlanningSnapshot: snapshot, editorialPlanningSnapshotDigest: snapshotDigest,
};

describe("editorial plan persistence boundary", () => {
  it("digests canonical plan JSON independent of object key order", () => {
    expect(editorialPlanDigest({ b: 2, a: 1 })).toBe(editorialPlanDigest({ a: 1, b: 2 }));
    expect(editorialPlanDigest(plan)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("matches the cross-runtime JSON-number fixture without erasing fractional scores", () => {
    const boundary = {
      planId: "p", version: 1, approvedStrategyDigest: "a".repeat(64),
      horizonStartAt: "2026-08-31T00:00:00Z", horizonEndAt: "2026-09-28T00:00:00Z", timezone: "UTC",
      summary: "s", sequencingRationale: "s", cadenceRationale: "c", assumptions: [], confidence: "high",
      items: [{
        id: "i", briefId: "b", campaignTheme: "t", contentPillar: "p", objective: "o", audienceId: "a",
        funnelStage: "awareness", intendedConversion: "c", ctaIntent: "c", kpi: "k", channel: "x", format: "text",
        evidenceRefs: ["m1"], publicationWindowStartAt: "2026-09-01T00:00:00Z", publicationWindowEndAt: "2026-09-01T01:00:00Z",
        productionDeadlineAt: "2026-08-31T12:00:00Z", priority: 1, selectionScore: 0, dependencies: [], productionStatus: "planned",
        constraints: [], requiredAssets: [], planningRationale: "r", selectionRationale: "r", confidence: "high",
      }], selectedNextItemId: "i",
    };
    const fractional = structuredClone(boundary);
    fractional.items[0].selectionScore = 0.5;
    expect(editorialPlanDigest(fractional)).not.toBe(editorialPlanDigest(boundary));
    expect(editorialPlanDigest({ score: -0, priority: 1.0 })).toBe(editorialPlanDigest({ score: 0, priority: 1 }));
    expect(editorialPlanDigest({ score: 0.000001 })).toBe("5202ed6a6376c41e3da111657d47f780e6a251a7e8cfa384fd0d59054f36f545");
    expect(editorialPlanDigest({ score: 0.0000001 })).toBe("27539988ad05838b3afeeae74e238d5130e3560aaf93a71be1d2fb494bee95fd");
    expect(editorialPlanDigest({ score: 0.5 })).toBe("e4ddae75dae7f08e3fe435a9366ad4b206916d510e4de005c1481c71816b938c");
  });

  it("binds a fresh plan to the exact approved strategy and revision", () => {
    expect(() => assertEditorialPlanSubmission(job, plan, 1)).not.toThrow();
    expect(() => assertEditorialPlanSubmission(job, { ...plan, approvedStrategyDigest: "b".repeat(64) }, 1)).toThrow("strategy digest");
    expect(() => assertEditorialPlanSubmission(job, plan, 2)).toThrow("stale editorial plan revision");
    expect(() => assertEditorialPlanSubmission({ ...job, stage: "draft" }, plan, 1)).toThrow("job stage");
    expect(() => assertEditorialPlanSubmission({ ...job, contentStrategy: undefined }, plan, 1)).toThrow("persisted strategy identity");
  });

  it("rejects replay and requires an eligible planned selected item", () => {
    const history = { v1: { digest: editorialPlanDigest(plan) } };
    expect(() => assertEditorialPlanSubmission({ ...job, editorialPlanHistory: history }, plan, 1)).toThrow("already exists");
    expect(() => assertEditorialPlanSubmission(job, { ...plan, items: [{ ...item, productionStatus: "selected" as never }] }, 1)).toThrow("selected item");
  });

  it("records sorted unique evidence lineage", () => {
    expect(editorialPlanEvidenceLineage(plan)).toEqual(["context:campaign", "m1"]);
  });

  it("builds one atomic reviewed-to-approval transition patch", () => {
    const patch = editorialDraftCompletionPatch("item-1", "2026-08-30T01:00:00Z", true);
    expect(patch).toEqual({
      "editorialItemStates.item-1": { status: "awaiting_approval", updatedAt: "2026-08-30T01:00:00Z" },
      stage: "awaiting_approval", status: "waiting_for_approval", updatedAt: "2026-08-30T01:00:00Z",
    });
  });

  it("recognizes only an exact idempotent awaiting-approval completion", () => {
    const authority = { editorialPlanId: plan.planId, editorialPlanDigest: editorialPlanDigest(plan), editorialItemId: item.id, briefId: item.briefId };
    const completed = { stage: "awaiting_approval", activeProductionLineage: authority,
      editorialItemStates: { [item.id]: { status: "awaiting_approval", updatedAt: "2026-08-30T01:00:00Z" } } };
    expect(isMatchingCompletedProduction(completed, authority, true)).toBe(true);
    expect(isMatchingCompletedProduction(completed, { ...authority, briefId: "other" }, true)).toBe(false);
    expect(isMatchingCompletedProduction(completed, authority, false)).toBe(false);
  });
});

describe("selected production authority", () => {
  it("requires the exact persisted plan, digest, item, brief, and lifecycle state", () => {
    const authority = { editorialPlanId: plan.planId, editorialPlanDigest: editorialPlanDigest(plan), editorialItemId: item.id, briefId: item.briefId };
    const productionJob = { stage: "draft", editorialPlan: plan, editorialPlanDigest: authority.editorialPlanDigest, selectedNextItemId: item.id,
      strategyDigest: "a".repeat(64), strategyApproval: { revision: 1 },
      strategyHistory: { v1: { digest: "a".repeat(64), revision: 1, strategy: { version: 1, briefs: [{ id: item.briefId }] } } },
      editorialItemStates: { [item.id]: { status: "selected", updatedAt: "2026-08-30T00:00:00Z" } } };
    expect(assertSelectedProductionAuthority(productionJob, authority, "selected").id).toBe(item.id);
    expect(() => assertSelectedProductionAuthority({ ...productionJob, editorialPlanDigest: "b".repeat(64) }, authority, "selected")).toThrow("digest");
    expect(() => assertSelectedProductionAuthority(productionJob, { ...authority, briefId: "other" }, "selected")).toThrow("brief");
    expect(() => assertSelectedProductionAuthority({ ...productionJob, strategyHistory: {} }, authority, "selected")).toThrow("strategy history");
    expect(() => assertSelectedProductionAuthority({ ...productionJob, editorialItemStates: { [item.id]: { status: "planned", updatedAt: "x" } } }, authority, "selected")).toThrow("lifecycle");
  });
  it("resumes only the exact already-claimed drafting lineage", () => {
    const authority = { editorialPlanId: plan.planId, editorialPlanDigest: editorialPlanDigest(plan), editorialItemId: item.id, briefId: item.briefId };
    const drafting = { stage: "draft", activeProductionLineage: authority,
      editorialItemStates: { [item.id]: { status: "drafting", updatedAt: "2026-08-30T00:00:00Z" } } };
    expect(isMatchingActiveProduction(drafting, authority)).toBe(true);
    expect(isMatchingActiveProduction(drafting, { ...authority, briefId: "other" })).toBe(false);
  });
});
