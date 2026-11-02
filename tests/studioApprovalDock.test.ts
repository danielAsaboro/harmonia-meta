import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ApprovalDock } from "../src/components/studio/ApprovalDock";

describe("ApprovalDock", () => {
  it("renders controls only for real pending planned actions", () => {
    const html = renderToStaticMarkup(createElement(ApprovalDock, {
      jobId: "job-1",
      actions: [
        { id: "pending", jobId: "job-1", type: "publish_x_post", title: "Publish", description: "", risk: "high", requiresApproval: true, approvalState: "pending", payload: {}, state: "planned" },
        { id: "done", jobId: "job-1", type: "generate_image", title: "Image", description: "", risk: "low", requiresApproval: false, approvalState: "not_required", payload: {}, state: "executed" },
      ],
      verifications: [], receipts: [], busy: false, onDecide: async () => {},
    }));
    expect(html).toContain('data-action-id="pending"');
    expect(html).not.toContain('data-action-id="done"');
    expect(html).toContain("Publishing remains blocked");
  });

  it("cannot let a generated approval surface remove protected action controls", () => {
    const html = renderToStaticMarkup(createElement(ApprovalDock, {
      jobId: "job-1",
      actions: [{ id: "pending", jobId: "job-1", type: "publish_x_post", title: "Publish", description: "", risk: "high", requiresApproval: true, approvalState: "pending", payload: {}, state: "planned" }],
      verifications: [], receipts: [], busy: false, onDecide: async () => {},
      operations: [
        { version: "v0.9", createSurface: { surfaceId: "studio-run-1-approval-r1", catalogId: "https://harmonia.app/a2ui/catalogs/chat/v1" } },
        { version: "v0.9", updateComponents: { surfaceId: "studio-run-1-approval-r1", components: [{ id: "root", component: "SurfaceEmpty", title: "No model controls", message: "Review detail only", children: [], emphasis: "primary", agentFraming: false }] } },
      ],
    }));
    expect(html).toContain('data-action-id="pending"');
    expect(html).toContain(">Reject<");
    expect(html).toContain(">Approve<");
  });

  it("hides a generated approval revision whose action is no longer pending", () => {
    const html = renderToStaticMarkup(createElement(ApprovalDock, {
      jobId: "job-1",
      actions: [{ id: "done", jobId: "job-1", type: "publish_x_post", title: "Publish", description: "", risk: "high", requiresApproval: true, approvalState: "approved", payload: {}, state: "executed" }],
      verifications: [], receipts: [], busy: false, onDecide: async () => {},
      operations: [
        { version: "v0.9", createSurface: { surfaceId: "studio-run-1-approval-r1", catalogId: "https://harmonia.app/a2ui/catalogs/chat/v1" } },
        { version: "v0.9", updateComponents: { surfaceId: "studio-run-1-approval-r1", components: [{ id: "root", component: "ApprovalReview", jobId: "job-1", actionId: "done", actionType: "publish_x_post", title: "Stale pending detail", description: "", risk: "high", requiresApproval: true, approvalState: "pending", actionState: "planned", destination: "X", children: [], emphasis: "primary", agentFraming: true }] } },
      ],
    }));

    expect(html).toBe("");
  });

  it("labels replay-only controls as proof tools instead of an empty approval queue", () => {
    const action = { id: "export", jobId: "job-1", type: "export_content_artifact" as const, title: "Export content pack", description: "", risk: "low" as const, requiresApproval: true, approvalState: "approved" as const, payload: {}, state: "executed" as const };
    const receipt = { id: "receipt-1", jobId: "job-1", actionId: "export", idempotencyKey: "idem-1", actionType: "export_content_artifact" as const, performedAt: "2026-09-04T00:00:00.000Z", outcome: "applied" as const, detail: {}, operationId: "operation-1", traceId: "a".repeat(32) };
    const html = renderToStaticMarkup(createElement(ApprovalDock, {
      jobId: "job-1", actions: [action], verifications: [], receipts: [receipt], claims: [{ id: "claim-1", actionId: "export", idempotencyKey: "idem-1", state: "applied", attempt: 1, claimedAt: "2026-09-04T00:00:00.000Z", finalizedAt: "2026-09-04T00:00:01.000Z", receiptId: "receipt-1", operationId: "operation-1", traceId: "a".repeat(32) }], busy: false, onDecide: async () => {},
    }));
    expect(html).toContain("Verification tools");
    expect(html).toContain("Prove duplicate suppression");
    expect(html).not.toContain("Review &amp; decide");
    expect(html).not.toContain("0 approval decisions pending");
  });
});
