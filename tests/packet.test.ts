import { describe, expect, it } from "vitest";
import { assemblePacket } from "@/lib/packet";
import type { JobConfig, PlannedAction, VerificationResult } from "@/lib/types";
import type { ContentArtifact } from "@/lib/contentArtifacts/contracts";

const config: JobConfig = { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] };

const artifact: ContentArtifact = { id: "d1", jobId: "j", outputPlanId: "p1", outputPlanDigest: "a".repeat(64), outputType: "x_post", revision: 1, title: "Post", sourceSegmentRefs: ["s1"], producer: { role: "noni", model: "gemini-3.5-flash", traceId: "b".repeat(32) }, review: { role: "dara", traceId: "c".repeat(32), decision: "accept" }, mimeType: "text/markdown", createdAt: "2026-08-30T00:00:00.000Z", payload: { kind: "x_post", text: "hi" }, contentDigest: "d".repeat(64) };
const publishAction: PlannedAction = {
  id: "a1", jobId: "j", type: "publish_x_post", title: "post to x", description: "",
  risk: "high", requiresApproval: true, approvalState: "approved", state: "executed",
  payload: { type: "publish_x_post", text: "hi" },
};

function verification(target: string, verified: boolean): VerificationResult {
  return {
    id: "v1", target, actionId: "a1", receiptId: "r", operationId: "j:verify:a1",
    traceId: "a".repeat(32), verified, method: "official_api_readback",
    evidence: { kind: "x_api", url: "https://x.com/i/web/status/1", fetchedAt: new Date().toISOString() },
    checkedAt: new Date().toISOString(),
  };
}

describe("assemblePacket", () => {
  it("lists pending approvals and failed verifications as unresolved gaps", () => {
    const packet = assemblePacket({
      jobId: "j", config,
      artifacts: [artifact],
      actions: [{ ...publishAction, approvalState: "pending" as const, state: "planned" as const }],
      receipts: [],
      verifications: [verification("tweet-1", false)],
    });
    expect(packet.unresolved.some((u) => u.includes("approval still pending"))).toBe(true);
    expect(packet.unresolved.some((u) => u.includes("not verified: tweet-1"))).toBe(true);
  });

  it("is clean when executed and verified", () => {
    const packet = assemblePacket({
      jobId: "j", config, artifacts: [artifact], actions: [publishAction],
      receipts: [{ id: "r", jobId: "j", actionId: "a1", idempotencyKey: "k".repeat(64), actionType: "publish_x_post", performedAt: new Date().toISOString(), outcome: "applied", operationId: "j:publish:a1", traceId: "a".repeat(32), detail: {} }],
      verifications: [verification("tweet-1", true)],
    });
    expect(packet.unresolved).toHaveLength(0);
  });

  it("requires one receipt and one verification for every executed action", () => {
    const withoutReceipt = assemblePacket({
      jobId: "j", config, artifacts: [artifact], actions: [publishAction], receipts: [],
      verifications: [verification("tweet-1", true)],
    });
    expect(withoutReceipt.unresolved).toContain("executed action has no receipt: post to x");

    const withoutVerification = assemblePacket({
      jobId: "j", config, artifacts: [artifact], actions: [publishAction],
      receipts: [{ id: "r", jobId: "j", actionId: "a1", idempotencyKey: "k".repeat(64), actionType: "publish_x_post", performedAt: new Date().toISOString(), outcome: "applied", operationId: "j:publish:a1", traceId: "a".repeat(32), detail: {} }],
      verifications: [],
    });
    expect(withoutVerification.unresolved).toContain("executed action has no verification: post to x");
  });
});
