import { describe, expect, it } from "vitest";
import type { JobFull, Receipt } from "../src/components/jobTypes";
import { hydrateSurfacePlan } from "../src/lib/a2ui/hydrateSurfacePlan";
import { surfacePlanSchema, type NodeArtDirection, type SurfaceArtDirection, type SurfacePlan } from "../src/lib/a2ui/presentationContracts";

const job: JobFull = {
  id: "job-1",
  status: "waiting_for_approval",
  stage: "awaiting_approval",
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:01:00.000Z",
  config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] },
  normalizedSources: [{ sourceId: "source-1", sourceKind: "video", title: "Interview", mimeType: "video/mp4", contentDigest: "c".repeat(64), extractorVersion: "media-v1", extractedAt: "2026-08-23T00:00:00.000Z", extractionReceiptId: "receipt-1", metadata: {}, segments: [{ id: "segment-1", text: "We cut setup time by half.", digest: "d".repeat(64), locator: { kind: "time_range", startMs: 4000, endMs: 12000 } }] }],
  sourceAnalysis: { sourceDigest: "a".repeat(64), summary: "Setup time proof.", moments: [{ id: "moment-1", title: "Setup time proof", startSec: 4, endSec: 12, hook: "Half the setup time", quote: "We cut setup time by half.", sourceSegmentRefs: ["segment-1"], visualEvidenceIds: [], assumptions: [], confidence: "high" }], angles: [], assumptions: [], confidence: "high" },
  contentArtifacts: [{ id: "draft-1", jobId: "job-1", outputPlanId: "plan-1", outputPlanDigest: "a".repeat(64), outputType: "x_post", revision: 1, title: "Launch", sourceSegmentRefs: ["segment-1"], producer: { role: "noni", model: "gemini-3.5-flash", traceId: "b".repeat(32) }, review: { role: "dara", traceId: "c".repeat(32), decision: "accept" }, mimeType: "text/markdown", createdAt: "2026-08-30T00:00:00.000Z", payload: { kind: "x_post", text: "Half the setup. More time shipping." }, contentDigest: "d".repeat(64) }],
  actions: [{
    id: "publish-1",
    jobId: "job-1",
    type: "publish_x_post",
    title: "Publish outcome post",
    description: "Publish the approved X draft.",
    risk: "high",
    requiresApproval: true,
    approvalState: "pending",
    payload: { text: "Half the setup. More time shipping." },
    state: "planned",
  }],
  assets: [],
};

const receipts: Receipt[] = [{
  id: "receipt-1",
  jobId: "job-1",
  actionId: "publish-1",
  idempotencyKey: "key-1",
  actionType: "publish_x_post",
  performedAt: "2026-08-23T00:02:00.000Z",
  outcome: "applied",
  operationId: "job-1:publish:publish-1",
  traceId: "a".repeat(32),
  detail: { remoteId: "post-1" },
}];

type PlannedNodeInput = Omit<SurfacePlan["surfaces"][number]["nodes"][number], "artDirection"> & {
  artDirection?: NodeArtDirection;
};

function plan(
  slot: "canvas" | "conversation" | "approval",
  node: PlannedNodeInput,
  artDirection?: SurfaceArtDirection,
): SurfacePlan {
  return surfacePlanSchema.parse({
    version: "harmonia.ui/v1",
    surfaces: [{ slot, revision: 1, rootId: node.id, ...(artDirection ? { artDirection } : {}), nodes: [node] }],
  });
}

function componentFrom(operations: Record<string, unknown>[], id: string): Record<string, unknown> {
  const update = operations.find((operation) => "updateComponents" in operation) as {
    updateComponents: { components: Array<Record<string, unknown>> };
  };
  const component = update.updateComponents.components.find((candidate) => candidate.id === id);
  if (!component) throw new Error(`Missing hydrated component ${id}`);
  return component;
}

describe("A2UI trusted hydration", () => {
  it("hydrates plan as the active durable stage from persisted job truth", () => {
    const result = hydrateSurfacePlan({
      runId: "run-plan",
      plan: plan("conversation", {
        id: "progress",
        component: "JobProgress",
        emphasis: "primary",
        refs: { jobId: "job-1", draftIds: [], momentIds: [], sourceIds: [], assetActionIds: [], actionIds: [], receiptIds: [] },
        children: [],
      }),
      job: { ...job, stage: "plan", status: "running" },
      receipts,
    });

    const serialized = JSON.stringify(result.conversation);
    expect(serialized).toContain('"id":"plan","label":"plan","status":"active"');
    expect(serialized).toContain('"id":"draft","label":"draft","status":"pending"');
  });

  it("hydrates bounded art direction onto catalog components", () => {
    const result = hydrateSurfacePlan({
      runId: "run-1",
      plan: plan("canvas", {
        id: "brief",
        component: "CampaignBrief",
        emphasis: "primary",
        refs: { jobId: "job-1", draftIds: [], momentIds: [], sourceIds: [], assetActionIds: [], actionIds: [], receiptIds: [] },
        artDirection: { tone: "ink", role: "hero", density: "airy", motion: "reveal" },
        children: [],
      }, { rhythm: "editorial", composition: "mosaic", energy: "active" }),
      job,
      receipts,
    });

    expect(componentFrom(result.canvas, "brief")).toMatchObject({
      tone: "ink",
      role: "hero",
      density: "airy",
      motion: "reveal",
      surfaceComposition: "mosaic",
      surfaceEnergy: "active",
      revision: 1,
    });
  });

  it("prevents unresolved state from using success styling", () => {
    const result = hydrateSurfacePlan({
      runId: "run-1",
      plan: plan("canvas", {
        id: "receipt",
        component: "VerificationReceipt",
        emphasis: "primary",
        refs: { jobId: "job-1", draftIds: [], momentIds: [], sourceIds: [], assetActionIds: [], actionIds: [], receiptIds: ["missing-receipt"] },
        artDirection: { tone: "acid", role: "feature", density: "balanced", motion: "reveal" },
        children: [],
      }),
      job,
      receipts,
    });

    expect(componentFrom(result.canvas, "receipt")).toMatchObject({
      component: "SurfaceUnresolved",
      tone: "coral",
      motion: "none",
    });
  });

  it("reserves acid verification styling for independently verified receipts", () => {
    const result = hydrateSurfacePlan({
      runId: "run-1",
      plan: plan("canvas", {
        id: "receipt",
        component: "VerificationReceipt",
        emphasis: "primary",
        refs: { jobId: "job-1", draftIds: [], momentIds: [], sourceIds: [], assetActionIds: [], actionIds: [], receiptIds: ["receipt-1"] },
        artDirection: { tone: "acid", role: "feature", density: "balanced", motion: "reveal" },
        children: [],
      }),
      job,
      receipts,
    });

    expect(componentFrom(result.canvas, "receipt")).toMatchObject({
      component: "VerificationReceipt",
      verified: false,
      tone: "paper",
      motion: "none",
    });
  });

  it("forces pending high-risk approvals into the coral consequence treatment", () => {
    const result = hydrateSurfacePlan({
      runId: "run-1",
      plan: plan("approval", {
        id: "approval",
        component: "ApprovalReview",
        emphasis: "primary",
        refs: { jobId: "job-1", draftIds: [], momentIds: [], sourceIds: [], assetActionIds: [], actionIds: ["publish-1"], receiptIds: [] },
        artDirection: { tone: "paper", role: "feature", density: "balanced", motion: "reveal" },
        children: [],
      }),
      job,
      receipts,
    });

    expect(componentFrom(result.approval, "approval")).toMatchObject({
      approvalState: "pending",
      risk: "high",
      tone: "coral",
    });
  });

  it("hydrates approval risk and content from the persisted action", () => {
    const result = hydrateSurfacePlan({
      runId: "run-1",
      plan: plan("approval", {
        id: "approval",
        component: "ApprovalReview",
        title: "Decision needed",
        emphasis: "primary",
        refs: { jobId: "job-1", actionIds: ["publish-1"], draftIds: [], momentIds: [], sourceIds: [], assetActionIds: [], receiptIds: [] },
        children: [],
      }),
      job,
      receipts,
    });

    const serialized = JSON.stringify(result.approval);
    expect(serialized).toContain('"risk":"high"');
    expect(serialized).toContain('"actionId":"publish-1"');
    expect(serialized).toContain("Half the setup. More time shipping.");
    expect(serialized).toContain('"agentFraming":true');
  });

  it("renders an unresolved component for a stale draft reference", () => {
    const result = hydrateSurfacePlan({
      runId: "run-1",
      plan: plan("canvas", {
        id: "drafts",
        component: "DraftComparison",
        emphasis: "primary",
        refs: { jobId: "job-1", draftIds: ["missing-draft"], momentIds: [], sourceIds: [], assetActionIds: [], actionIds: [], receiptIds: [] },
        children: [],
      }),
      job,
      receipts,
    });

    const serialized = JSON.stringify(result.canvas);
    expect(serialized).toContain("SurfaceUnresolved");
    expect(serialized).toContain("missing-draft");
    expect(serialized).not.toContain("DraftComparison");
  });

  it("keeps generated node hierarchy and revision in v0.9 operations", () => {
    const result = hydrateSurfacePlan({
      runId: "run-9",
      plan: {
        version: "harmonia.ui/v1",
        surfaces: [{
          slot: "canvas",
          revision: 3,
          rootId: "brief",
          artDirection: { rhythm: "editorial", composition: "stack", energy: "quiet" },
          nodes: [
            { id: "brief", component: "CampaignBrief", emphasis: "primary", refs: { jobId: "job-1", draftIds: [], momentIds: [], sourceIds: [], assetActionIds: [], actionIds: [], receiptIds: [] }, artDirection: { tone: "paper", role: "support", density: "balanced", motion: "none" }, children: ["drafts"] },
            { id: "drafts", component: "DraftComparison", emphasis: "secondary", refs: { jobId: "job-1", draftIds: ["draft-1"], momentIds: [], sourceIds: [], assetActionIds: [], actionIds: [], receiptIds: [] }, artDirection: { tone: "paper", role: "support", density: "balanced", motion: "none" }, children: [] },
          ],
        }],
      },
      job,
      receipts,
    });

    expect(result.canvas[0]).toEqual({
      version: "v0.9",
      createSurface: { surfaceId: "studio-run-9-canvas-r3", catalogId: "https://harmonia.app/a2ui/catalogs/chat/v1" },
    });
    const update = result.canvas[1] as { updateComponents: { components: Array<Record<string, unknown>> } };
    expect(update.updateComponents.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "root", component: "Column", children: ["brief"] }),
      expect.objectContaining({ id: "brief", component: "CampaignBrief", children: ["drafts"] }),
      expect.objectContaining({ id: "drafts", component: "DraftComparison" }),
    ]));
  });
});
