import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { JobFull } from "@/components/jobTypes";
import { ProductionWorkspace } from "@/components/studio/ProductionWorkspace";
import { compileProductionOperations, productionPlanDigest, videoProductionPlanSchema } from "@/lib/mediaProduction";

const plan = videoProductionPlanSchema.parse({
  id: "media-plan-1", jobId: "job-1", workspaceId: "workspace-1", brandId: "brand-1", revision: 1,
  goal: "Launch the autonomous content engine", audience: "startup founders", tone: ["clear"],
  target: { platform: "linkedin", durationSec: 4, aspectRatio: "9:16", resolution: "1080p", frameRate: 30, format: "mp4" },
  scenes: [{
    id: "scene-1", order: 1, startSec: 0, durationSec: 4, purpose: "Show the product loop",
    video: { modelCapability: "veo-3.1-fast", mode: "text_to_video", prompt: "A precise product workflow", durationSec: 4, aspectRatio: "9:16", resolution: "1080p", generateAudio: false, enhancePrompt: true, outputCount: 1 },
    overlays: [], captions: [], transitions: [],
  }],
  narration: [],
  constraints: { allowLikeness: false, allowGeneratedVocals: false, requireLicensedSources: true },
  pricingVersion: "2026-08-31", operationCostsUsd: { "media-plan-1:generate_video:scene-1": "0.320000" }, estimatedCostUsd: "0.320000", maximumCostUsd: "0.400000",
});
const digest = productionPlanDigest(plan);
const operations = compileProductionOperations(plan);
const job: JobFull = {
  id: "job-1", status: "active", stage: "publish", createdAt: "2026-08-31T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z",
  config: { sourceManifestId: "manifest-1", desiredOutputs: [], allowedOutputs: [], platforms: [] }, actions: [],
  productionPlan: {
    aggregate: { id: plan.id, jobId: jobId(), workspaceId: plan.workspaceId, brandId: plan.brandId, state: "sealed", currentRevision: 1, currentPlanDigest: digest, activeMandateId: null, currentMandateReservedCostUsd: "0.000000", internalRun: 0, createdAt: "2026-08-31T00:00:00.000Z", updatedAt: "2026-08-31T00:00:00.000Z" },
    revision: { revision: 1, plan, planDigest: digest, operations, proposedAt: "2026-08-31T00:00:00.000Z" },
    operations: operations.map((operation, index) => ({ id: operation.id, type: operation.type, executionAuthority: operation.executionAuthority, dependsOn: operation.dependsOn, ...(operation.estimatedCostUsd ? { estimatedCostUsd: operation.estimatedCostUsd } : {}), state: index === 0 ? "waiting_provider" : "pending", attempt: index === 0 ? 1 : 0 })),
  },
};

function jobId() { return "job-1"; }

describe("production workspace", () => {
  it("shows the exact production approval boundary, cost, rationale, and graph state", () => {
    const html = renderToStaticMarkup(createElement(ProductionWorkspace, { job, onDecide: () => {}, onSeal: () => {} }));
    expect(html).toContain("Launch the autonomous content engine");
    expect(html).toContain("Approve production · $0.400000");
    expect(html).toContain("Production approval only.");
    expect(html).toContain("External publication remains separately gated.");
    expect(html).toContain("veo-3.1-fast");
    expect(html).toContain("waiting_provider");
    expect(html).not.toContain("Approve publication");
  });
});
