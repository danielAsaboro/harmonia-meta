import { afterAll, describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import { createEffectCommand, effectCommandDigest, type EffectCommandInput } from "@/lib/effectCommands";
import { claimCommandEffect, createCommand, finalizeCommandReceipt, getCommand, transitionCommandEffect } from "@/lib/effectCommandStore";
import { db, getDurableOperation, getJob, listReceipts } from "@/lib/firestore";
import { runWithTenant } from "@/lib/tenancy";
import type { PlannedAction, Receipt } from "@/lib/types";
import { actionPayloadDigest } from "@/lib/idempotency";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const scope = { workspaceId: "command-test", brandId: "brand-test", principal: servicePrincipal("command-integration") };
const jobId = `command-${Date.now()}`;
const action: PlannedAction = {
  id: "action-1", jobId, type: "publish_x_post", title: "Publish", description: "",
  risk: "high", requiresApproval: true, approvalState: "approved", payload: { text: "Launch" }, state: "planned",
};
const draft: EffectCommandInput = {
  id: "command-1", workspaceId: scope.workspaceId, brandId: scope.brandId,
  sourceKind: "job_action", sourceId: action.id, jobId, actionId: action.id,
  actionType: action.type, payload: action.payload,
  authorization: { kind: "approval", approvalId: action.id, approvedPayloadDigest: "pending" },
};
const command = createEffectCommand({ ...draft, authorization: { kind: "approval", approvalId: action.id, approvedPayloadDigest: effectCommandDigest(draft) } });
const jobPath = `workspaces/${scope.workspaceId}/jobs/${jobId}`;
const approval = (approvedAction: PlannedAction, id = approvedAction.id) => ({ id, jobId: approvedAction.jobId, actionId: approvedAction.id, decision: "approved", payloadDigest: actionPayloadDigest(approvedAction), actorType: "firebase_operator", actorSubjectId: "operator-test", authenticationId: "firebase-test", channel: "dashboard", operationId: `${approvedAction.jobId}:approval:${approvedAction.id}`, traceId: "a".repeat(32), decidedAt: new Date().toISOString() });

describe.skipIf(!emulator)("effect command Firestore aggregate", () => {
  it("grants one owner and atomically finalizes command, claim, receipt, and action", async () => {
    await db().doc(jobPath).set({
      workspaceId: scope.workspaceId, brandId: scope.brandId, createdByUserId: "operator-test",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "running",
      stage: "publish", config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, actions: [action],
    });
    const approvalRef = db().doc(`${jobPath}/approval_decisions/${action.id}`);
    await approvalRef.set({ ...approval(action), actorType: "service", channel: "telegram" });
    await runWithTenant(scope, () => createCommand(command));
    const owner = { operationId: `job:${jobId}:effect:${command.id}`, traceId: "a".repeat(32) };
    await expect(runWithTenant(scope, () => claimCommandEffect(command.id, { ...owner, claimToken: "non-human-owner" }))).rejects.toThrow("stale");
    await approvalRef.set(approval(action));
    const outcomes = await runWithTenant(scope, () => Promise.all([
      claimCommandEffect(command.id, { ...owner, claimToken: "owner-a" }),
      claimCommandEffect(command.id, { ...owner, claimToken: "owner-b" }),
    ]));
    expect(outcomes.map((value) => value.outcome).sort()).toEqual(["execute", "in_progress"]);
    const winner = outcomes.find((value) => value.outcome === "execute")!;
    if (winner.outcome !== "execute" || !winner.claim.operationEpoch) throw new Error("effect operation was not claimed");
    const fence = {
      operationId: owner.operationId, epoch: winner.claim.operationEpoch,
      workspaceId: scope.workspaceId, brandId: scope.brandId,
      now: new Date().toISOString(),
    };
    await runWithTenant(scope, () => transitionCommandEffect(command.id, {
      phase: "dispatched", claimToken: winner.claim.claimToken, attempt: winner.claim.attempt,
    }, fence));
    await runWithTenant(scope, () => transitionCommandEffect(command.id, {
      phase: "observed", claimToken: winner.claim.claimToken, outcome: "applied", detail: {},
    }, { ...fence, now: new Date().toISOString() }));
    const receipt: Receipt = {
      id: "receipt-1", jobId, actionId: action.id, actionType: action.type,
      idempotencyKey: command.payloadDigest, performedAt: new Date().toISOString(), outcome: "applied",
      detail: {}, operationId: owner.operationId, traceId: owner.traceId,
    };
    await runWithTenant(scope, () => finalizeCommandReceipt(
      command.id, receipt, winner.claim.claimToken, { ...fence, now: receipt.performedAt },
    ));
    const aggregate = await runWithTenant(scope, async () => ({
      command: await getCommand(command.id), job: await getJob(jobId), receipts: await listReceipts(jobId),
      operation: await getDurableOperation(owner.operationId),
    }));
    expect(aggregate.command?.state).toBe("applied");
    expect(aggregate.job.actions[0].state).toBe("executed");
    expect(aggregate.receipts).toHaveLength(1);
    expect(aggregate.operation).toMatchObject({
      state: "succeeded", epoch: winner.claim.operationEpoch,
      goal: { digest: command.payloadDigest },
    });
  });

  it("atomically quarantines a post-dispatch ambiguity with its operation", async () => {
    const unknownJobId = `${jobId}-unknown`;
    const unknownAction = { ...action, jobId: unknownJobId, id: "action-unknown" };
    const unknownDraft: EffectCommandInput = {
      ...draft, id: "command-unknown", jobId: unknownJobId,
      sourceId: unknownAction.id, actionId: unknownAction.id, payload: unknownAction.payload,
    };
    const unknownCommand = createEffectCommand({
      ...unknownDraft,
      authorization: { kind: "approval", approvalId: unknownAction.id, approvedPayloadDigest: effectCommandDigest(unknownDraft) },
    });
    await db().doc(`workspaces/${scope.workspaceId}/jobs/${unknownJobId}`).set({
      workspaceId: scope.workspaceId, brandId: scope.brandId, createdByUserId: "operator-test",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "running",
      stage: "publish", config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, actions: [unknownAction],
    });
    await db().doc(`workspaces/${scope.workspaceId}/jobs/${unknownJobId}/approval_decisions/${unknownAction.id}`).set(approval(unknownAction));
    await runWithTenant(scope, () => createCommand(unknownCommand));
    const operationId = `job:${unknownJobId}:effect:${unknownCommand.id}`;
    const claimed = await runWithTenant(scope, () => claimCommandEffect(unknownCommand.id, {
      operationId, traceId: "c".repeat(32), claimToken: "unknown-owner",
    }));
    if (claimed.outcome !== "execute" || !claimed.claim.operationEpoch) throw new Error("claim failed");
    const fence = {
      operationId, epoch: claimed.claim.operationEpoch,
      workspaceId: scope.workspaceId, brandId: scope.brandId, now: new Date().toISOString(),
    };
    await runWithTenant(scope, () => transitionCommandEffect(unknownCommand.id, {
      phase: "dispatched", claimToken: "unknown-owner", attempt: 1,
    }, fence));
    await runWithTenant(scope, () => transitionCommandEffect(unknownCommand.id, {
      phase: "unknown", claimToken: "unknown-owner", reason: "provider response lost",
    }, { ...fence, now: new Date().toISOString() }));
    const [storedCommand, storedOperation] = await runWithTenant(scope, () => Promise.all([
      getCommand(unknownCommand.id), getDurableOperation(operationId),
    ]));
    expect(storedCommand).toMatchObject({ state: "unknown", unknownReason: "provider response lost" });
    expect(storedOperation).toMatchObject({ state: "unknown", unresolvedReason: "provider response lost" });
    await expect(runWithTenant(scope, () => claimCommandEffect(unknownCommand.id, {
      operationId, traceId: "d".repeat(32), claimToken: "retry-owner",
    }))).rejects.toThrow("effect command is unknown");
  });

  it("reclaims only a dispatch proven not to have entered the provider", async () => {
    const retryJobId = `${jobId}-retry`;
    const retryAction = { ...action, jobId: retryJobId, id: "action-retry" };
    const retryDraft: EffectCommandInput = {
      ...draft, id: "command-retry", jobId: retryJobId,
      sourceId: retryAction.id, actionId: retryAction.id, payload: retryAction.payload,
    };
    const retryCommand = createEffectCommand({
      ...retryDraft,
      authorization: { kind: "approval", approvalId: retryAction.id, approvedPayloadDigest: effectCommandDigest(retryDraft) },
    });
    await db().doc(`workspaces/${scope.workspaceId}/jobs/${retryJobId}`).set({
      workspaceId: scope.workspaceId, brandId: scope.brandId, createdByUserId: "operator-test",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), status: "running",
      stage: "publish", config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, actions: [retryAction],
    });
    await db().doc(`workspaces/${scope.workspaceId}/jobs/${retryJobId}/approval_decisions/${retryAction.id}`).set(approval(retryAction));
    await runWithTenant(scope, () => createCommand(retryCommand));
    const operationId = `job:${retryJobId}:effect:${retryCommand.id}`;
    const first = await runWithTenant(scope, () => claimCommandEffect(retryCommand.id, {
      operationId, traceId: "e".repeat(32), claimToken: "first-owner",
    }));
    if (first.outcome !== "execute" || !first.claim.operationEpoch) throw new Error("claim failed");
    const fence = {
      operationId, epoch: first.claim.operationEpoch,
      workspaceId: scope.workspaceId, brandId: scope.brandId, now: new Date().toISOString(),
    };
    await runWithTenant(scope, () => transitionCommandEffect(retryCommand.id, {
      phase: "dispatched", claimToken: "first-owner", attempt: 1,
    }, fence));
    await runWithTenant(scope, () => transitionCommandEffect(retryCommand.id, {
      phase: "provider_not_started", claimToken: "first-owner",
    }, { ...fence, now: new Date().toISOString() }));
    const second = await runWithTenant(scope, () => claimCommandEffect(retryCommand.id, {
      operationId, traceId: "f".repeat(32), claimToken: "second-owner",
    }));
    expect(second).toMatchObject({ outcome: "execute", claim: { operationEpoch: 2, attempt: 2 } });
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${scope.workspaceId}`));
  });
});
