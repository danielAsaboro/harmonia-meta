import { describe, expect, it } from "vitest";
import { buildUiContext } from "../src/lib/a2ui/presentationContext";
import type { JobFull } from "../src/components/jobTypes";

const job: JobFull = {
  id: "job-1",
  status: "waiting_for_approval",
  stage: "awaiting_approval",
  createdAt: "2026-08-23T00:00:00.000Z",
  updatedAt: "2026-08-23T00:01:00.000Z",
  config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] },
  normalizedSources: [{ sourceId: "source-1", sourceKind: "video", title: "Interview", mimeType: "video/mp4", contentDigest: "c".repeat(64), extractorVersion: "media-v1", extractedAt: "2026-08-23T00:00:00.000Z", extractionReceiptId: "receipt-1", metadata: {}, segments: [{ id: "segment-1", text: "private transcript text", digest: "d".repeat(64), locator: { kind: "time_range", startMs: 10000, endMs: 20000 } }] }],
  sourceAnalysis: { sourceDigest: "a".repeat(64), summary: "Outcome proof.", moments: [{ id: "moment-1", title: "Outcome proof", startSec: 10, endSec: 20, hook: "Proof", quote: "We cut setup time.", sourceSegmentRefs: ["segment-1"], visualEvidenceIds: [], assumptions: [], confidence: "high" }], angles: [{ id: "angle-1", angleType: "source_insight", evidenceKind: "source", title: "Outcome-led launch", rationale: "Lead with proof.", evidenceRefs: ["moment-1"], assumptions: [], confidence: "high" }], assumptions: [], confidence: "high" },
  contentArtifacts: [{ id: "draft-1", jobId: "job-1", outputPlanId: "plan-1", outputPlanDigest: "a".repeat(64), outputType: "x_post", revision: 1, title: "Launch", sourceSegmentRefs: ["segment-1"], producer: { role: "noni", model: "gemini-3.5-flash", traceId: "b".repeat(32) }, review: { role: "dara", traceId: "c".repeat(32), decision: "accept" }, mimeType: "text/markdown", createdAt: "2026-08-30T00:00:00.000Z", payload: { kind: "x_post", text: "full draft text must stay server-side" }, contentDigest: "d".repeat(64) }],
  actions: [{
    id: "publish-1",
    jobId: "job-1",
    type: "publish_x_post",
    title: "Publish launch post",
    description: "Send the selected launch draft.",
    risk: "high",
    requiresApproval: true,
    approvalState: "pending",
    payload: { text: "secret payload text", accessToken: "credential-value" },
    state: "planned",
  }],
  assets: [{ actionId: "image-1", mime: "image/png", sizeBytes: 512, digest: "asset-digest" }],
};

describe("A2UI presentation context", () => {
  it("includes identifiers and summaries but excludes authored content and action payloads", () => {
    const context = buildUiContext({
      runId: "run-1",
      message: "Show drafts",
      response: { intent: "list_artifacts", reply: "Artifacts ready.", jobId: "job-1" },
      job,
      receipts: [],
    });

    expect(context.drafts).toEqual([{ id: "draft-1", platform: "x_post", valid: true }]);
    expect(context.actions).toEqual([{ id: "publish-1", type: "publish_x_post", pending: true }]);
    expect(context.sources).toEqual(expect.arrayContaining([
      { id: "source-1", kind: "video", label: "Interview" },
      { id: "source-1:segment-1", kind: "segment", label: "time_range · segment-1" },
    ]));
    const serialized = JSON.stringify(context);
    expect(serialized).not.toContain("full draft text");
    expect(serialized).not.toContain("private transcript text");
    expect(serialized).not.toContain("secret payload text");
    expect(serialized).not.toContain("credential-value");
    expect(serialized).not.toContain("youtube.com");
  });

  it("bounds every entity collection before schema validation", () => {
    const manyDrafts = Array.from({ length: 30 }, (_, index) => ({ ...job.contentArtifacts![0], id: `draft-${index}` }));
    const context = buildUiContext({
      runId: "run-2",
      message: "Compare everything",
      response: { intent: "list_artifacts", reply: "Ready.", jobId: "job-1" },
      job: { ...job, contentArtifacts: manyDrafts },
      receipts: [],
    });

    expect(context.drafts).toHaveLength(20);
  });
});
