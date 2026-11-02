import { describe, expect, it } from "vitest";
import { buildStudioWorkspace } from "../src/lib/studio/workspaceModel";

describe("studio workspace model", () => {
  it("groups only persisted artifacts by action and MIME", () => {
    const model = buildStudioWorkspace({
      id: "job-1", status: "complete", stage: "complete", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
      config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [],
      actions: [
        { id: "img", jobId: "job-1", type: "generate_image", title: "Launch visual", description: "", risk: "low", requiresApproval: false, approvalState: "not_required", payload: {}, state: "executed" },
        { id: "sound", jobId: "job-1", type: "generate_music", title: "Launch score", description: "", risk: "low", requiresApproval: false, approvalState: "not_required", payload: {}, state: "executed" },
      ],
      assets: [
        { actionId: "img", mime: "image/png", sizeBytes: 1200, digest: "a" },
        { actionId: "sound", mime: "audio/mpeg", sizeBytes: 2400, digest: "b" },
      ],
    }, []);
    expect(model.visual.map((asset) => asset.actionId)).toEqual(["img"]);
    expect(model.audio.map((asset) => [asset.actionId, asset.provider])).toEqual([["sound", "lyria"]]);
    expect(model.motion).toEqual([]);
  });

  it("marks an artifact source reference invalid when its segment is absent", () => {
    const model = buildStudioWorkspace({
      id: "job-2", status: "complete", stage: "complete", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
      config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [],
      contentArtifacts: [{ id: "d1", jobId: "job-2", outputPlanId: "plan-1", outputPlanDigest: "a".repeat(64), outputType: "x_post", revision: 1, title: "Claim", sourceSegmentRefs: ["missing"], producer: { role: "noni", model: "gemini-3.5-flash", traceId: "b".repeat(32) }, review: { role: "dara", traceId: "c".repeat(32), decision: "accept" }, mimeType: "text/markdown", createdAt: "2026-08-30T00:00:00.000Z", payload: { kind: "x_post", text: "Grounded claim" }, contentDigest: "d".repeat(64) }], actions: [], assets: [],
    }, []);
    expect(model.traceLinks).toEqual([
      expect.objectContaining({ artifactId: "d1", valid: false, error: "source segment missing not found" }),
    ]);
  });

  it("recognizes canonical position-based segment ids over extractor-native ids", () => {
    const model = buildStudioWorkspace({
      id: "job-3", status: "complete", stage: "complete", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
      config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] },
      normalizedSources: [{
        sourceId: "source-1", sourceKind: "video", title: "Source", mimeType: "video/mp4",
        contentDigest: "a".repeat(64), extractorVersion: "youtube/v1", extractedAt: "2026-08-23T00:00:00.000Z",
        segments: [{ id: "provider-segment-7", text: "Evidence", locator: { kind: "time_range", startMs: 1, endMs: 2 }, digest: "b".repeat(64) }],
        metadata: {}, extractionReceiptId: "receipt-1",
      }],
      contentArtifacts: [{ id: "d2", jobId: "job-3", outputPlanId: "plan-1", outputPlanDigest: "a".repeat(64), outputType: "x_post", revision: 1, title: "Claim", sourceSegmentRefs: ["source-1:seg-1"], producer: { role: "noni", model: "gemini-3.5-flash", traceId: "b".repeat(32) }, review: { role: "dara", traceId: "c".repeat(32), decision: "accept" }, mimeType: "text/markdown", createdAt: "2026-08-30T00:00:00.000Z", payload: { kind: "x_post", text: "Grounded claim" }, contentDigest: "d".repeat(64) }],
      actions: [], assets: [],
    }, []);
    expect(model.traceLinks).toEqual([expect.objectContaining({ artifactId: "d2", valid: true })]);
  });
});
