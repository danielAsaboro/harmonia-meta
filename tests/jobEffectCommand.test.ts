import { describe, expect, it } from "vitest";

import { buildJobActionCommand } from "@/lib/jobEffectCommands";
import { actionPayloadDigest } from "@/lib/idempotency";
import type { ApprovalDecision, Job, PlannedAction } from "@/lib/types";

const action: PlannedAction = {
  id: "action-1", jobId: "job-1", type: "publish_x_post", title: "Publish", description: "",
  risk: "high", requiresApproval: true, approvalState: "approved", payload: { text: "Launch" }, state: "planned",
};
const job = {
  id: "job-1", workspaceId: "workspace-1", brandId: "brand-1", createdByUserId: "user-1",
  createdAt: "2026-08-26T00:00:00.000Z", updatedAt: "2026-08-26T00:00:00.000Z",
  status: "running", controlEpoch: 0, controlState: "running", stage: "publish", config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] },
  budget: { estimatedUsd: "0", observedUsd: "0", reservedUsd: "0", limitUsd: "0", approvalThresholdUsd: "0" },
} satisfies Job;
const approval = {
  id: action.id, jobId: job.id, actionId: action.id, decision: "approved",
  payloadDigest: actionPayloadDigest(action), actorType: "firebase_operator",
  actorSubjectId: "user-1", authenticationId: "session-1", channel: "dashboard",
  operationId: "job-1:approval:action-1", traceId: "a".repeat(32), decidedAt: "2026-08-26T01:00:00.000Z",
} satisfies ApprovalDecision;

describe("job effect command materialization", () => {
  it("requires an approval that matches the current action payload", () => {
    const command = buildJobActionCommand(job, action, approval, "2026-08-26T01:01:00.000Z");
    expect(command.authorization).toMatchObject({ kind: "approval", approvalId: action.id });
    expect(command.payload).toEqual(action.payload);
    expect(() => buildJobActionCommand(job, { ...action, payload: { text: "Changed" } }, approval))
      .toThrow("approval payload changed");
  });

  it("preserves bounded autonomy for policy-safe actions through a mandate snapshot", () => {
    const safe = { ...action, type: "export_content_artifact" as const, requiresApproval: false, approvalState: "not_required" as const };
    const command = buildJobActionCommand(job, safe, null);
    expect(command.authorization).toMatchObject({ kind: "mandate", mandateId: "job:job-1" });
  });

  it("seals host-resolved command dependencies into the immutable command", () => {
    const command = buildJobActionCommand(
      job,
      action,
      approval,
      "2026-08-26T01:01:00.000Z",
      ["cmd-child-2", "cmd-child-1"],
    );

    expect(command.dependsOnCommandIds).toEqual(["cmd-child-1", "cmd-child-2"]);
  });
});
