import { afterAll, describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import { editorialPlanDigest, editorialPlanningSnapshotDigest } from "@/lib/editorialPlan";
import { acceptEditorialPlan, db, getJob } from "@/lib/firestore";
import { runWithTenant } from "@/lib/tenancy";
import type { ContentStrategy, EditorialPlan } from "@/lib/types";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const scope = { workspaceId: "temi-plan-test", brandId: "brand-test", principal: servicePrincipal("temi-plan-integration") };
const otherScope = { workspaceId: "temi-plan-other", brandId: "brand-test", principal: servicePrincipal("temi-plan-integration") };
const jobId = `temi-plan-${Date.now()}`;
const strategyDigest = "a".repeat(64);
const snapshot = {
  snapshotId: `planning-${jobId}-v1`, asOf: "2026-08-27T00:00:00Z",
  horizonStartAt: "2026-08-31T00:00:00Z", horizonEndAt: "2026-09-28T00:00:00Z", timezone: "UTC",
  channelCapabilities: [{ channel: "x", formats: ["thread"] }], existingCommitments: [],
  productionCapacity: { maxItems: 8, maxItemsPerWeek: 2 }, cadenceConstraints: { minimumHoursBetweenItems: 24, maxItemsPerChannelPerWeek: 2 },
  postingWindowObservations: [], assetReadiness: [], blockedDependencies: [], calendarProjection: [],
  provenanceIds: ["policy:editorial-planning-v1"],
};
const snapshotDigest = editorialPlanningSnapshotDigest(snapshot);
const campaignOutputPlan = {
  id: "output-plan-1", digest: "b".repeat(64), desiredOutputs: ["x_post"], allowedOutputs: ["x_post"],
  outputs: [{ id: "output-1", outputType: "x_post", quantity: 1, destinations: ["x"], evidenceRefs: ["source-1:seg-1"], costClass: "local", approvalClass: "effect" }],
};
const item = {
  id: "item-1", briefId: "brief-1", campaignTheme: "Proof", contentPillar: "Outcomes", objective: "Earn consideration",
  audienceId: "founders", funnelStage: "consideration" as const, intendedConversion: "Request demo", ctaIntent: "See workflow", kpi: "Qualified demos",
  channel: "x", format: "thread", evidenceRefs: ["moment-1", "context:campaign"],
  publicationWindowStartAt: "2026-09-01T16:00:00Z", publicationWindowEndAt: "2026-09-01T18:00:00Z", productionDeadlineAt: "2026-08-31T18:00:00Z",
  priority: 1, selectionScore: 0.9, dependencies: [], productionStatus: "planned" as const, constraints: ["No unsupported metrics"], requiredAssets: [],
  planningRationale: "Lead with proof.", selectionRationale: "Highest priority eligible item.", confidence: "high" as const,
};
const plan: EditorialPlan = {
  planId: "plan-1", version: 1, approvedStrategyDigest: strategyDigest,
  planningSnapshotId: snapshot.snapshotId, planningSnapshotDigest: snapshotDigest,
  horizonStartAt: "2026-08-31T00:00:00Z", horizonEndAt: "2026-09-28T00:00:00Z", timezone: "UTC",
  summary: "Proof campaign", sequencingRationale: "Proof before education", cadenceRationale: "One item per week",
  assumptions: ["Capacity remains available"], confidence: "high", items: [item], selectedNextItemId: item.id,
};

describe.skipIf(!emulator)("Temi editorial plan Firestore boundary", () => {
  it("round-trips the complete plan and binds it to tenant and approved strategy", async () => {
    const strategy = { strategyId: "strategy-1", version: 1 } as ContentStrategy;
    const path = `workspaces/${scope.workspaceId}/jobs/${jobId}`;
    await db().doc(path).set({
      workspaceId: scope.workspaceId, brandId: scope.brandId, createdByUserId: "operator-test",
      createdAt: "2026-08-27T00:00:00Z", updatedAt: "2026-08-27T00:00:00Z", status: "running", stage: "plan",
      config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, contentStrategy: strategy, strategyDigest, strategyRevision: 1,
      strategyApprovalState: "approved", strategyApproval: { decision: "approved", payloadDigest: strategyDigest, revision: 1, actorSubjectId: "operator-test", decidedAt: "2026-08-27T00:00:00Z", expiresAt: "2026-08-28T00:00:00Z" },
      editorialPlanningSnapshot: snapshot, editorialPlanningSnapshotDigest: snapshotDigest,
      campaignOutputPlan,
    });

    const accepted = await runWithTenant(scope, () => acceptEditorialPlan(jobId, plan, 1));
    const stored = await runWithTenant(scope, () => getJob(jobId));
    expect(stored.editorialPlan).toEqual(plan);
    expect(stored.editorialPlanDigest).toBe(editorialPlanDigest(plan));
    expect(stored.editorialPlanEvidenceLineage).toEqual(["context:campaign", "moment-1"]);
    expect(stored.editorialPlanHistory?.v1.plan).toEqual(plan);
    expect(stored.editorialPlanHistory?.v1.strategyDigest).toBe(strategyDigest);
    expect(stored.editorialItemStates).toEqual({ [item.id]: expect.objectContaining({ status: "selected" }) });
    expect(stored.campaignOutputPlan).toEqual(campaignOutputPlan);
    expect(accepted.selectedNextItemId).toBe(item.id);
    await expect(runWithTenant(otherScope, () => getJob(jobId))).rejects.toThrow("job not found");
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${scope.workspaceId}`));
  });
});
