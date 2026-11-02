import { afterAll, describe, expect, it } from "vitest";

import { claimEffect, db, finalizeEffectReceipt, getEffectClaim, getJob, listReceipts } from "@/lib/firestore";
import { runWithTenant } from "@/lib/tenancy";
import { servicePrincipal } from "@/lib/authority";
import { actionPayloadDigest } from "@/lib/idempotency";
import type { EffectClaimInput, PlannedAction, Receipt } from "@/lib/types";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const scope = {
  workspaceId: "claim-test",
  brandId: "brand-test",
  principal: servicePrincipal("test-auth"),
};
const jobId = `claim-${Date.now()}`;
const action: PlannedAction = {
  id: "action-1", jobId, type: "export_content_artifact", title: "Export", description: "",
  risk: "low", requiresApproval: true, approvalState: "approved", payload: {}, state: "planned",
};
const jobPath = `workspaces/${scope.workspaceId}/jobs/${jobId}`;

describe.skipIf(!emulator)("effect claim Firestore transaction", () => {
  it("rejects an approved action flag without a durable human approval decision", async () => {
    const forgedJobId = `${jobId}-forged`;
    const forgedAction = { ...action, jobId: forgedJobId };
    const forgedJobPath = `workspaces/${scope.workspaceId}/jobs/${forgedJobId}`;
    await db().doc(forgedJobPath).set({
      workspaceId: scope.workspaceId, brandId: scope.brandId, createdByUserId: "operator-test",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "running",
      stage: "publish", config: { platforms: [] }, actions: [forgedAction],
    });

    await expect(runWithTenant(scope, () => claimEffect({
      jobId: forgedJobId, actionId: forgedAction.id, actionType: forgedAction.type,
      idempotencyKey: "f".repeat(64), operationId: `${forgedJobId}:publish:${forgedAction.id}`,
      traceId: "e".repeat(32), claimToken: "forged-owner",
    }))).rejects.toThrow("effect claim requires a durable approval decision");

    await db().recursiveDelete(db().doc(forgedJobPath));
  });

  it("rejects an approval record without authenticated human actor provenance", async () => {
    const partialJobId = `${jobId}-partial-approval`;
    const partialAction = { ...action, jobId: partialJobId };
    const partialJobPath = `workspaces/${scope.workspaceId}/jobs/${partialJobId}`;
    await db().doc(partialJobPath).set({
      workspaceId: scope.workspaceId, brandId: scope.brandId, createdByUserId: "operator-test",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "running",
      stage: "publish", config: { platforms: [] }, actions: [partialAction],
    });
    await db().doc(`${partialJobPath}/approval_decisions/${partialAction.id}`).set({
      id: partialAction.id,
      jobId: partialJobId,
      actionId: partialAction.id,
      decision: "approved",
      payloadDigest: actionPayloadDigest(partialAction),
      actorType: "firebase_operator",
      operationId: `${partialJobId}:approval:${partialAction.id}`,
      traceId: "d".repeat(32),
      decidedAt: new Date().toISOString(),
    });

    await expect(runWithTenant(scope, () => claimEffect({
      jobId: partialJobId, actionId: partialAction.id, actionType: partialAction.type,
      idempotencyKey: "9".repeat(64), operationId: `${partialJobId}:publish:${partialAction.id}`,
      traceId: "8".repeat(32), claimToken: "partial-approval-owner",
    }))).rejects.toThrow("effect claim requires authenticated approval provenance");

    await db().recursiveDelete(db().doc(partialJobPath));
  });

  it("grants one concurrent owner and atomically links claim, receipt, and action", async () => {
    const approvedAction: PlannedAction = { ...action, approvalState: "approved" };
    await db().doc(jobPath).set({
      workspaceId: scope.workspaceId, brandId: scope.brandId, createdByUserId: "operator-test",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "running",
      stage: "publish", config: { platforms: [] }, actions: [approvedAction],
    });
    await db().doc(`${jobPath}/approval_decisions/${approvedAction.id}`).set({
      id: approvedAction.id,
      jobId,
      actionId: approvedAction.id,
      decision: "approved",
      payloadDigest: actionPayloadDigest(approvedAction),
      actorType: "firebase_operator",
      actorSubjectId: "operator-test",
      authenticationId: "operator-session",
      channel: "dashboard",
      operationId: `${jobId}:approval:${approvedAction.id}`,
      traceId: "c".repeat(32),
      decidedAt: new Date().toISOString(),
    });
    const base: EffectClaimInput = {
      jobId, actionId: action.id, actionType: action.type, idempotencyKey: "a".repeat(64),
      operationId: `${jobId}:publish:${action.id}`, traceId: "b".repeat(32), claimToken: "owner-1",
    };
    const outcomes = await runWithTenant(scope, () => Promise.all([
      claimEffect(base),
      claimEffect({ ...base, claimToken: "owner-2" }),
    ]));
    expect(outcomes.map((result) => result.outcome).sort()).toEqual(["execute", "in_progress"]);
    const owner = outcomes.find((result) => result.outcome === "execute")!;
    const receipt: Receipt = {
      id: "receipt-1", jobId, actionId: action.id, actionType: action.type,
      idempotencyKey: base.idempotencyKey, performedAt: new Date().toISOString(), outcome: "applied",
      detail: {}, operationId: base.operationId, traceId: base.traceId,
    };
    await runWithTenant(scope, () => finalizeEffectReceipt(receipt, owner.claim.claimToken));
    const [claim, receipts, job] = await runWithTenant(scope, () => Promise.all([
      getEffectClaim(jobId, base.idempotencyKey), listReceipts(jobId), getJob(jobId),
    ]));
    expect(claim).toMatchObject({ state: "applied", receiptId: receipt.id });
    expect(receipts).toHaveLength(1);
    expect(job.actions[0]).toMatchObject({ state: "executed" });
  });

  it("reclaims a crashed pre-dispatch owner and still finalizes exactly one receipt", async () => {
    const recoveryJobId = `${jobId}-pre-dispatch-crash`;
    const recoveryAction: PlannedAction = {
      ...action,
      id: "recovery-action",
      jobId: recoveryJobId,
      requiresApproval: false,
      approvalState: "not_required",
    };
    const recoveryJobPath = `workspaces/${scope.workspaceId}/jobs/${recoveryJobId}`;
    const key = "c".repeat(64);
    await db().doc(recoveryJobPath).set({
      workspaceId: scope.workspaceId, brandId: scope.brandId, createdByUserId: "operator-test",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "running",
      stage: "publish", config: { platforms: [] }, actions: [recoveryAction],
    });

    const first = await runWithTenant(scope, () => claimEffect({
      jobId: recoveryJobId, actionId: recoveryAction.id, actionType: recoveryAction.type,
      idempotencyKey: key, operationId: `${recoveryJobId}:effect:first-owner`,
      traceId: "1".repeat(32), claimToken: "crashed-owner",
    }));
    expect(first).toMatchObject({ outcome: "execute", claim: { attempt: 1 } });
    await db().doc(`${recoveryJobPath}/effect_claims/${key}`).update({
      leaseExpiresAt: "2026-08-30T00:00:00.000Z",
    });

    const replacement = await runWithTenant(scope, () => claimEffect({
      jobId: recoveryJobId, actionId: recoveryAction.id, actionType: recoveryAction.type,
      idempotencyKey: key, operationId: `${recoveryJobId}:effect:replacement-owner`,
      traceId: "2".repeat(32), claimToken: "replacement-owner",
    }));
    expect(replacement).toMatchObject({
      outcome: "execute", claim: { attempt: 2, claimToken: "replacement-owner" },
    });

    const receipt: Receipt = {
      id: "recovery-receipt-1", jobId: recoveryJobId, actionId: recoveryAction.id,
      actionType: recoveryAction.type, idempotencyKey: key, performedAt: new Date().toISOString(),
      outcome: "applied", detail: { digest: "d".repeat(64) },
      operationId: `${recoveryJobId}:effect:replacement-owner`, traceId: "2".repeat(32),
    };
    await runWithTenant(scope, () => finalizeEffectReceipt(receipt, "replacement-owner"));

    const replay = await runWithTenant(scope, () => claimEffect({
      jobId: recoveryJobId, actionId: recoveryAction.id, actionType: recoveryAction.type,
      idempotencyKey: key, operationId: `${recoveryJobId}:effect:duplicate`,
      traceId: "3".repeat(32), claimToken: "duplicate-owner",
    }));
    const receipts = await runWithTenant(scope, () => listReceipts(recoveryJobId));
    expect(replay).toMatchObject({ outcome: "already_applied", receiptId: receipt.id });
    expect(receipts).toEqual([expect.objectContaining({ id: receipt.id, outcome: "applied" })]);

    await db().recursiveDelete(db().doc(recoveryJobPath));
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(jobPath));
  });
});
