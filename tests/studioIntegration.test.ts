import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StudioConsoleView } from "../src/components/ChatConsole";
import type { JobFull } from "../src/components/jobTypes";

describe("studio console integration", () => {
  it("renders a hydrated conversation and cross-media approval working set", () => {
    const job: JobFull = {
      id: "job-1", status: "waiting_for_approval", stage: "awaiting_approval" as const, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
      config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [],
      contentArtifacts: [{ id: "draft-1", jobId: "job-1", outputPlanId: "plan-1", outputPlanDigest: "a".repeat(64), outputType: "x_post", revision: 1, title: "Launch", sourceSegmentRefs: ["segment-1"], producer: { role: "noni", model: "gemini-3.5-flash", traceId: "b".repeat(32) }, review: { role: "dara", traceId: "c".repeat(32), decision: "accept" }, mimeType: "text/markdown", createdAt: "2026-08-30T00:00:00.000Z", payload: { kind: "x_post", text: "The launch is here." }, contentDigest: "d".repeat(64) }],
      actions: [{ id: "publish-1", jobId: "job-1", type: "publish_x_post" as const, title: "Publish launch", description: "", risk: "high" as const, requiresApproval: true, approvalState: "pending" as const, payload: { text: "The launch is here." }, state: "planned" as const }],
      assets: [{ actionId: "image-1", mime: "image/png", sizeBytes: 1200, digest: "d" }],
    };
    const html = renderToStaticMarkup(createElement(StudioConsoleView, {
      messages: [{ role: "user", text: "Create launch content" }, { role: "assistant", text: "The working set is ready", data: { intent: "create_job", reply: "", jobId: "job-1" } }],
      loaded: true, detail: { job, events: [], receipts: [] }, liveRun: null, input: "", onInputChange: () => {}, attachments: [], onAttachmentsChange: () => {}, busy: false, onSend: () => {}, onOpenJob: () => {}, selectedArtifactId: null, onSelectedArtifactChange: () => {}, mobilePane: "conversation", onMobilePaneChange: () => {}, onDecide: () => {}, onOperationDecision: () => {},
    }));
    expect(html).toContain("Source bundle manifest");
    expect(html).toContain("--studio-conversation:2fr");
    expect(html).toContain("Posts");
    expect(html).toContain("publish-1");
    expect(html).toContain("Needs approval");
    expect(html).toContain("One decision is waiting for you");
    expect(html).toContain("Review &amp; decide");
    expect(html).toContain('data-a2ui-slot="conversation"');
    expect(html).toContain('data-a2ui-slot="canvas"');
    expect(html).toContain('data-a2ui-slot="approval"');
    expect(html).not.toContain("Agent-generated interface");
  });
});
