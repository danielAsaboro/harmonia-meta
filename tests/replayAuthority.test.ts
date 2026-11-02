import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { effectClaimResponse, redactEffectClaim } from "@/lib/effectClaims";
import { assertReplayApplied, replayEligibleReceipt } from "@/lib/replay";
import { isReplayableAction } from "@/lib/replayEligibility";
import type { EffectClaim, Job, PlannedAction, Receipt } from "@/lib/types";

const action: PlannedAction = {
  id: "action-1", jobId: "job-1", type: "export_content_artifact", title: "Export",
  description: "", risk: "low", requiresApproval: true, approvalState: "approved",
  payload: {}, state: "executed",
};
const job = { id: "job-1", actions: [action] } as Job & { actions: PlannedAction[] };
const receipt: Receipt = {
  id: "receipt-1", jobId: "job-1", actionId: "action-1", actionType: "export_content_artifact",
  idempotencyKey: "a".repeat(64), operationId: "effect-op", traceId: "b".repeat(32),
  performedAt: "2026-08-25T01:00:00Z", outcome: "applied", detail: {},
};
const appliedClaim: EffectClaim = {
  id: receipt.idempotencyKey, jobId: "job-1", actionId: "action-1", actionType: "export_content_artifact",
  idempotencyKey: receipt.idempotencyKey, operationId: receipt.operationId, traceId: receipt.traceId,
  claimToken: "private-owner-token", state: "applied", attempt: 1,
  claimedAt: "2026-08-25T00:59:00Z", leaseExpiresAt: "2026-08-25T01:04:00Z",
  finalizedAt: "2026-08-25T01:00:01Z", receiptId: receipt.id,
};

describe("operator replay authority", () => {
  it("allows a human member to prove only an approved executed receipt", () => {
    expect(replayEligibleReceipt(job, "action-1", [receipt], "member")).toBe(receipt);
    expect(() => replayEligibleReceipt(job, "action-1", [receipt], "service")).toThrow("human operator");
    expect(() => replayEligibleReceipt({ ...job, actions: [{ ...action, state: "planned" }] }, "action-1", [receipt], "owner")).toThrow("executed action");
    expect(() => replayEligibleReceipt(job, "action-1", [], "owner")).toThrow("applied receipt");
  });

  it("accepts only already-applied claim outcomes and never execute", () => {
    expect(assertReplayApplied({ outcome: "already_applied", receiptId: "receipt-1" })).toBe("receipt-1");
    for (const outcome of ["execute", "in_progress", "uncertain"] as const) {
      expect(() => assertReplayApplied({ outcome })).toThrow("cannot execute");
    }
  });

  it("records replay proof only through the operator route", () => {
    const internalClaimRoute = readFileSync("src/app/api/internal/effect-claim/route.ts", "utf8");
    const operatorReplayRoute = readFileSync("src/lib/replay.ts", "utf8");
    expect(internalClaimRoute).not.toContain("writeReplayObservation");
    expect(operatorReplayRoute).toContain("writeReplayObservation");
  });

  it("surfaces replay only when the receipt has a finalized applied claim", () => {
    const publicClaim = redactEffectClaim(appliedClaim);
    expect(isReplayableAction(action, [receipt], [publicClaim])).toBe(true);
    expect(isReplayableAction(action, [receipt], [])).toBe(false);
    expect(isReplayableAction(action, [receipt], [{ ...publicClaim, state: "claimed", receiptId: undefined, finalizedAt: undefined }])).toBe(false);
  });

  it("redacts ownership credentials and correlates claim responses", () => {
    const publicClaim = redactEffectClaim(appliedClaim);
    expect(publicClaim).not.toHaveProperty("claimToken");
    expect(publicClaim).not.toHaveProperty("leaseExpiresAt");
    expect(effectClaimResponse({ outcome: "already_applied", claim: appliedClaim, receiptId: receipt.id }, {
      jobId: "job-1", actionId: "action-1", actionType: "export_content_artifact",
      idempotencyKey: receipt.idempotencyKey, operationId: "replay-op", traceId: "c".repeat(32), claimToken: "new-token",
    })).toEqual({
      outcome: "already_applied", attempt: 1, receiptId: receipt.id,
      idempotencyKey: receipt.idempotencyKey, operationId: "replay-op", traceId: "c".repeat(32),
    });
  });
});
