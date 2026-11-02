import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MediaWorkspace } from "../src/components/studio/MediaWorkspace";
import { WorkingCanvas } from "../src/components/studio/WorkingCanvas";
import { surfaceRevisionRequest } from "../src/lib/a2ui/workspaceActions";

describe("studio canvas", () => {
  it("renders native audio only for a persisted audio asset", () => {
    const html = renderToStaticMarkup(createElement(MediaWorkspace, {
      kind: "audio",
      jobId: "job-1",
      assets: [{ actionId: "sound", kind: "audio", mime: "audio/mpeg", title: "Launch score", sizeBytes: 2400, digest: "d", provider: "lyria" }],
      selectedArtifactId: null,
      onSelect: () => {},
    }));
    expect(html).toContain("<audio");
    expect(html).toContain("Lyria");
    expect(html).toContain("/api/jobs/job-1/assets/sound");
  });

  it("shows an honest generated-video empty state", () => {
    const html = renderToStaticMarkup(createElement(MediaWorkspace, {
      kind: "motion", jobId: "job-1", assets: [], selectedArtifactId: null, onSelect: () => {},
    }));
    expect(html).toContain("No motion asset exists for this working set");
    expect(html).not.toContain("Veo generated");
  });

  it("mounts a generated canvas without a collapsed appendix label", () => {
    const html = renderToStaticMarkup(createElement(WorkingCanvas, {
      job: {
        id: "job-1", status: "running", stage: "draft", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
        config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [], actions: [], assets: [],
      },
      events: [], receipts: [], selectedArtifactId: null, onSelectedArtifactChange: () => {},
      operations: [
        { version: "v0.9", createSurface: { surfaceId: "studio-run-1-canvas-r1", catalogId: "https://harmonia.app/a2ui/catalogs/chat/v1" } },
        { version: "v0.9", updateComponents: { surfaceId: "studio-run-1-canvas-r1", components: [{ id: "root", component: "SurfaceEmpty", title: "Waiting", message: "No drafts yet", children: [], emphasis: "primary", agentFraming: false }] } },
      ],
    }));
    expect(html).not.toContain("Agent-generated interface");
    expect(html).not.toContain("<summary>Agent-generated");
    expect(html).toContain("Workflow details");
    expect(html.indexOf("Campaign direction")).toBeLessThan(html.indexOf("Workflow details"));
  });

  it("keeps a failed working set visible and exposes its retry action", () => {
    const html = renderToStaticMarkup(createElement(WorkingCanvas, {
      job: {
        id: "job-failed", status: "failed", stage: "understand", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
        config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [], actions: [], assets: [],
        failure: {
          stage: "understand", category: "dependency", code: "agent_unavailable", publicMessage: "A required dependency is temporarily unavailable.", retryable: true,
          operationId: "operation-1", traceId: "trace-1", attempt: 1, maxAttempts: 3, details: {}, at: "2026-08-23T00:01:00.000Z",
        },
      },
      events: [], receipts: [], selectedArtifactId: null, onSelectedArtifactChange: () => {}, onRetry: () => {},
    }));
    expect(html).toContain("A required dependency is temporarily unavailable.");
    expect(html).toContain("Blocked");
    expect(html).toContain(">Retry</button>");
    expect(html).toContain("Your saved work is still here");
    expect(html.indexOf("Blocked")).toBeLessThan(html.indexOf("A required dependency is temporarily unavailable."));
  });

  it("turns a view revision into a normal grounded chat request", () => {
    expect(surfaceRevisionRequest("job-1", "draft-2")).toBe(
      "Show drafts for job job-1. Recompose the generated comparison around draft draft-2.",
    );
  });

  it("shows the operator retry control for a retryable persisted job failure", () => {
    const html = renderToStaticMarkup(createElement(WorkingCanvas, {
      job: {
        id: "job-retry", status: "failed", stage: "understand", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z",
        config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [], actions: [], assets: [],
        failure: { stage: "understand", category: "dependency", code: "managed_dependency_unavailable", publicMessage: "A required dependency is temporarily unavailable.", retryable: true, operationId: "op-1", traceId: "a".repeat(32), attempt: 0, maxAttempts: 3, details: {}, at: "2026-08-23T00:00:00.000Z" },
      },
      events: [], receipts: [], selectedArtifactId: null, onSelectedArtifactChange: () => {}, onRetry: () => {},
    }));
    expect(html).toContain("A required dependency is temporarily unavailable.");
    expect(html).toContain(">Retry</button>");
  });

  it("shows actionable contract metadata without offering a blind permanent retry", () => {
    const html = renderToStaticMarkup(createElement(WorkingCanvas, {
      job: {
        id: "job-contract", status: "failed", stage: "strategize", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:01:00.000Z",
        config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [], actions: [], assets: [],
        failure: { stage: "strategize", category: "validation", code: "internal_contract_rejected", publicMessage: "Stage input or output did not satisfy its contract.", retryable: false, operationId: "op-1", traceId: "a".repeat(32), attempt: 0, maxAttempts: 3, details: { endpoint: "/api/internal/strategy-context", path: "sourceIds", issueCode: "too_big", maximum: 24 }, at: "2026-09-04T00:01:00.000Z" },
      },
      events: [], receipts: [], selectedArtifactId: null, onSelectedArtifactChange: () => {}, onRetry: () => {},
    }));
    expect(html).toContain("sourceIds");
    expect(html).toContain("too_big");
    expect(html).toContain("Technical details");
    expect(html).toContain("Harmonia needs a correction before this job can continue.");
    expect(html).toContain(">Continue after correction</button>");
    expect(html).not.toContain(">Retry</button>");
  });

  it("puts the operator state and artifacts ahead of execution proof", () => {
    const html = renderToStaticMarkup(createElement(WorkingCanvas, {
      job: {
        id: "job-approval", status: "waiting_for_approval", stage: "awaiting_approval", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:01:00.000Z",
        config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, normalizedSources: [], assets: [],
        actions: [{ id: "publish", jobId: "job-approval", type: "publish_x_post", title: "Publish launch post", description: "Review the final post.", risk: "high", requiresApproval: true, approvalState: "pending", payload: {}, state: "planned" }],
      },
      events: [], receipts: [], selectedArtifactId: null, onSelectedArtifactChange: () => {}, onDecide: async () => {},
    }));
    expect(html).toContain("Needs approval");
    expect(html).toContain("One decision is waiting for you");
    expect(html).toContain("Review <b class=\"text-[#d8ff3e]\">1</b>");
    expect(html.indexOf("Campaign direction")).toBeLessThan(html.indexOf("Execution proof"));
    expect(html).toContain('aria-label="Open proof and audit trail"');
    expect(html).toContain('aria-label="Proof and audit trail"');
  });

  it("does not show an empty review control", () => {
    const html = renderToStaticMarkup(createElement(WorkingCanvas, {
      job: {
        id: "job-working", status: "running", stage: "draft", createdAt: "2026-09-04T00:00:00.000Z", updatedAt: "2026-09-04T00:01:00.000Z",
        config: { operatorBrief: "Turn the launch film into a founder-led campaign.", sourceManifestId: "manifest-1", desiredOutputs: ["x_post", "short_clip"], allowedOutputs: ["x_post", "short_clip"], platforms: ["x", "linkedin"] }, normalizedSources: [], actions: [], assets: [],
      },
      events: [], receipts: [], selectedArtifactId: null, onSelectedArtifactChange: () => {}, onDecide: async () => {},
    }));
    expect(html).toContain("Working");
    expect(html).not.toContain("Review <b");
    expect(html).not.toContain("Review &amp; decide");
    expect(html).toContain("Saved job brief");
    expect(html).toContain("Turn the launch film into a founder-led campaign.");
    expect(html).toContain("X post");
    expect(html).toContain("Short clip");
    expect(html).toContain("X · LinkedIn");
  });
});
