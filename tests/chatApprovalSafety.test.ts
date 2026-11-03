import { describe, expect, it, vi } from "vitest";

import { buildApprovalConfirmation } from "@/lib/chatHandler";
import { actionPayloadDigest } from "@/lib/idempotency";
import type { Job, PlannedAction } from "@/lib/types";

const job = {
  id: "job-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  createdByUserId: "user-1",
  stage: "awaiting_approval",
  status: "running",
  controlState: "running",
  controlEpoch: 0,
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
  config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] },
  budget: { estimatedUsd: "0", observedUsd: "0", reservedUsd: "0", limitUsd: "0", approvalThresholdUsd: "0" },
  actions: [{
    id: "action-1",
    jobId: "job-1",
    type: "publish_x_post",
    title: "Publish launch",
    description: "Exact launch copy",
    risk: "high",
    requiresApproval: true,
    approvalState: "pending",
    payload: { text: "We launched." },
    state: "planned",
  }],
} as Job & { actions: PlannedAction[] };

describe("chat approval safety", () => {
  it("turns model-classified dashboard text into confirmation, never a decision", async () => {
    const createOperation = vi.fn().mockResolvedValue({ id: "operation-1" });
    const result = await buildApprovalConfirmation(job, "dashboard", createOperation);
    expect(createOperation).toHaveBeenCalledWith(expect.objectContaining({
      handler: "decide_job_action",
      arguments: {
        jobId: "job-1",
        actionId: "action-1",
        payloadDigest: actionPayloadDigest(job.actions[0]),
      },
    }));
    expect(result).not.toHaveProperty("outcome");
    expect(result.pendingActions).toHaveLength(1);
    expect(result.confirmation).toEqual({ operationId: "operation-1", payloadDigest: actionPayloadDigest(job.actions[0]) });
  });

  it("keeps Telegram text read-only until a verified callback arrives", async () => {
    const createOperation = vi.fn();
    const result = await buildApprovalConfirmation(job, "telegram", createOperation);
    expect(createOperation).not.toHaveBeenCalled();
    expect(result.confirmation).toBeUndefined();
    expect(result.pendingActions).toHaveLength(1);
  });
});
