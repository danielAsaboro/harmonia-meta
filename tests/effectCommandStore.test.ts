import { describe, expect, it } from "vitest";

import { assertCommandReceipt, commandClaimInput } from "@/lib/effectCommandStore";
import { createEffectCommand, effectCommandDigest, type EffectCommandInput } from "@/lib/effectCommands";
import type { Receipt } from "@/lib/types";

const draft: EffectCommandInput = {
  id: "command-1", workspaceId: "workspace-1", brandId: "brand-1",
  sourceKind: "job_action", sourceId: "action-1", jobId: "job-1", actionId: "action-1",
  actionType: "publish_x_post", payload: { text: "Launch" },
  authorization: { kind: "approval", approvalId: "approval-1", approvedPayloadDigest: "pending" },
  now: "2026-08-26T00:00:00.000Z",
};
const command = createEffectCommand({ ...draft, authorization: { kind: "approval", approvalId: "approval-1", approvedPayloadDigest: effectCommandDigest(draft) } });

describe("effect command store contracts", () => {
  it("derives the provider claim identity from the immutable command", () => {
    expect(commandClaimInput(command, { claimToken: "owner-1", operationId: "op-1", traceId: "a".repeat(32) }))
      .toMatchObject({ jobId: "job-1", actionId: "action-1", idempotencyKey: command.payloadDigest });
  });

  it("rejects a receipt reconstructed from a mutable source", () => {
    const receipt: Receipt = {
      id: "receipt-1", jobId: "job-1", actionId: "action-1", actionType: "publish_x_post",
      idempotencyKey: "f".repeat(64), performedAt: "2026-08-26T01:00:00.000Z", outcome: "applied",
      detail: {}, operationId: "op-1", traceId: "a".repeat(32),
    };
    expect(() => assertCommandReceipt(command, receipt)).toThrow("immutable command");
  });
});
