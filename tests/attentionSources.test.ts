import { describe, expect, it } from "vitest";

import { buildAttentionSources } from "@/lib/operations/attentionSources";

describe("durable attention source compiler", () => {
  it("compiles approvals, failures, unknown effects, resident requests, missing assets, and credentials", () => {
    const sources = buildAttentionSources({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      jobs: [{
        id: "job-1", stage: "awaiting_approval", status: "failed", updatedAt: "2026-08-31T00:00:00.000Z",
        config: { platforms: ["x"] }, strategyApprovalState: "pending",
        actions: [{ id: "action-1", title: "Publish launch", state: "planned", approvalState: "pending" }],
        failure: { category: "policy", code: "unsafe_claim", publicMessage: "A claim lacks evidence.", at: "2026-08-31T00:00:00.000Z" },
        editorialPlanningSnapshot: { assetReadiness: [{ id: "asset-1", status: "missing", assetType: "video", briefId: "brief-1" }] },
      }],
      connectedPlatforms: [],
      unknownEffects: [{ jobId: "job-1", operationId: "operation-1", commandId: "command-1", reason: "provider response lost" }],
      residentAttention: [{ id: "attention-1", state: "open", failureType: "budget_exhaustion", reason: "Budget is exhausted.", createdAt: "2026-08-31T00:00:00.000Z" }],
    });
    expect(sources.map((source) => source.kind).sort()).toEqual([
      "approval", "budget_required", "credential_required", "missing_asset", "policy_block", "strategy_decision", "uncertain_effect",
    ]);
  });

  it("does not revive stale job blockers after a job is complete", () => {
    expect(buildAttentionSources({
      workspaceId: "workspace-1", brandId: "brand-1", connectedPlatforms: [], unknownEffects: [], residentAttention: [],
      jobs: [{ id: "job-done", stage: "complete", status: "complete", updatedAt: "2026-08-31T00:00:00.000Z", config: { platforms: ["x"] }, strategyApprovalState: "pending", actions: [{ id: "old", title: "Old", state: "planned", approvalState: "pending" }] }],
    })).toEqual([]);
  });
});
