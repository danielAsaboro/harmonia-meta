import { describe, expect, test, vi } from "vitest";
import { MessageProcessor } from "@a2ui/web_core/v0_9";
import { harmoniaCatalog, parseHarmoniaA2uiOperation, surfaceFrameMetadata, surfaceMotionState } from "../src/components/a2ui/HarmoniaCatalog";
import { generateResponseSurfaces } from "../src/lib/a2ui/responseSurface";
import type { JobFull } from "../src/components/jobTypes";

const job: JobFull = {
  id: "job-1", status: "waiting_for_approval", stage: "awaiting_approval", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:01:00.000Z",
  config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [],
  contentArtifacts: [{ id: "draft-1", jobId: "job-1", outputPlanId: "plan-1", outputPlanDigest: "a".repeat(64), outputType: "x_post", revision: 1, title: "Launch", sourceSegmentRefs: ["segment-1"], producer: { role: "noni", model: "gemini-3.5-flash", traceId: "b".repeat(32) }, review: { role: "dara", traceId: "c".repeat(32), decision: "accept" }, mimeType: "text/markdown", createdAt: "2026-08-30T00:00:00.000Z", payload: { kind: "x_post", text: "This full draft must not reach the planner." }, contentDigest: "d".repeat(64) }],
  actions: [], assets: [],
};

describe("Harmonia A2UI surfaces", () => {
  test("animates only live operation growth and live revision advances", () => {
    expect(surfaceMotionState({ live: false, operationsGrew: true, previousRevision: 1, revision: 2 })).toEqual({
      liveUpdate: false,
      revisionChanged: false,
    });
    expect(surfaceMotionState({ live: true, operationsGrew: true, previousRevision: 1, revision: 2 })).toEqual({
      liveUpdate: true,
      revisionChanged: true,
    });
    expect(surfaceMotionState({ live: true, operationsGrew: false, previousRevision: 2, revision: 2 })).toEqual({
      liveUpdate: false,
      revisionChanged: false,
    });
  });

  test("passes bounded context to the planner and materializes its hydrated surface", async () => {
    const planner = vi.fn().mockResolvedValue({
      version: "harmonia.ui/v1",
      surfaces: [{
        slot: "canvas",
        revision: 1,
        rootId: "drafts",
        artDirection: { rhythm: "cinematic", composition: "split", energy: "active" },
        nodes: [{
          id: "drafts",
          component: "DraftComparison",
          refs: { jobId: "job-1", draftIds: ["draft-1"] },
          artDirection: { tone: "violet", role: "feature", density: "balanced", motion: "reveal" },
          children: [],
        }],
      }],
    });
    const surfaces = await generateResponseSurfaces({
      runId: "run-1",
      message: "Compare the drafts",
      response: { intent: "list_artifacts", reply: "One artifact is ready.", jobId: "job-1" },
      job,
      receipts: [],
      planner,
    });
    const processor = new MessageProcessor([harmoniaCatalog]);
    processor.processMessages(surfaces.canvas as never[]);

    const surface = processor.model.getSurface("studio-run-1-canvas-r1");
    expect(surface?.componentsModel.get("root")).toBeTruthy();
    expect(surface?.componentsModel.get("drafts")?.properties.drafts[0].text).toContain("full draft");
    expect(surface?.componentsModel.get("drafts")?.properties.tone).toBe("violet");
    expect(surfaceFrameMetadata(surface)).toEqual({
      composition: "split",
      rhythm: "cinematic",
      energy: "active",
      revision: 1,
    });
    expect(planner).toHaveBeenCalledWith(expect.objectContaining({ intent: "list_artifacts" }));
    expect(JSON.stringify(planner.mock.calls[0][0])).not.toContain("full draft");
  });

  test("the trusted host rejects unknown components before processing", () => {
    expect(() => parseHarmoniaA2uiOperation({
      version: "v0.9",
      updateComponents: { surfaceId: "s1", components: [{ id: "root", component: "ArbitraryHtml", html: "<script />" }] },
    })).toThrow("not registered");
  });

  test("the trusted host accepts hydrated Harmonia workspace components", () => {
    const operations = [{
      version: "v0.9",
      createSurface: { surfaceId: "studio-run-1-approval-r1", catalogId: "https://harmonia.app/a2ui/catalogs/chat/v1" },
    }, {
      version: "v0.9",
      updateComponents: {
        surfaceId: "studio-run-1-approval-r1",
        components: [{ id: "root", component: "Column", children: ["approval"] }, {
          id: "approval",
          component: "ApprovalReview",
          jobId: "job-1",
          actionId: "publish-1",
          actionType: "publish_x_post",
          title: "Publish launch post",
          description: "Publish the approved post.",
          risk: "high",
          requiresApproval: true,
          approvalState: "pending",
          actionState: "planned",
          children: [],
          emphasis: "primary",
          agentFraming: false,
        }],
      },
    }];
    expect(() => operations.map(parseHarmoniaA2uiOperation)).not.toThrow();
    const processor = new MessageProcessor([harmoniaCatalog]);
    processor.processMessages(operations as never[]);
    expect(processor.model.getSurface("studio-run-1-approval-r1")?.componentsModel.get("approval")).toBeTruthy();
  });

  test("surfaces planner failures without a deterministic fallback", async () => {
    await expect(generateResponseSurfaces({
      runId: "run-2",
      message: "Show the job",
      response: { intent: "status", reply: "Ready.", jobId: "job-1" },
      job,
      receipts: [],
      planner: vi.fn().mockRejectedValue(new Error("Agent Engine unavailable")),
    })).rejects.toThrow("Agent Engine unavailable");
  });

  test("rejects a model-invented reference before hydration or persistence", async () => {
    await expect(generateResponseSurfaces({
      runId: "run-3", message: "Compare drafts",
      response: { intent: "list_artifacts", reply: "Ready.", jobId: "job-1" }, job, receipts: [],
      planner: vi.fn().mockResolvedValue({ version: "harmonia.ui/v1", surfaces: [{ slot: "canvas", revision: 1,
        rootId: "drafts", nodes: [{ id: "drafts", component: "DraftComparison",
          refs: { jobId: "job-1", draftIds: ["invented"] }, children: [] }] }] }),
    })).rejects.toThrow("unknown draft");
  });
});
