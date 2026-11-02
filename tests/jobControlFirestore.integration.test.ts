import { afterAll, describe, expect, it } from "vitest";

import { firebasePrincipal } from "@/lib/authority";
import { createJob, db, getJob, listDispatchableStageOutbox } from "@/lib/firestore";
import { createCommandEnvelope } from "@/lib/operations/commands";
import { JobControlCommandStore } from "@/lib/operations/commandStore";
import { claimCommandEffect, createCommand } from "@/lib/effectCommandStore";
import { createEffectCommand, effectCommandDigest, type EffectCommandInput } from "@/lib/effectCommands";
import { runWithTenant } from "@/lib/tenancy";
import { actionPayloadDigest } from "@/lib/idempotency";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const workspaceId = `job-control-test-${Date.now()}`;
const scope = {
  workspaceId,
  brandId: "brand-test",
  principal: firebasePrincipal({ subjectId: "user-test", workspaceRole: "owner", authenticationId: "firebase-test" }),
};

describe.skipIf(!emulator)("job control Firestore transaction", () => {
  it("records one receipt and returns it for an identical command retry", async () => {
    const job = await runWithTenant(scope, () => createJob({ sourceManifestId: "manifest-control", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, "understand"));
    const command = createCommandEnvelope({
      commandId: "pause-command-1",
      jobId: job.id,
      action: "pause",
      expectedControlEpoch: 0,
      actor: { actorType: "firebase_operator", subjectId: "user-test", authenticationId: "firebase-test" },
      receivedAt: "2026-08-31T00:00:00.000Z",
    });
    const store = new JobControlCommandStore(db());
    const first = await runWithTenant(scope, () => store.record(command));
    const duplicate = await runWithTenant(scope, () => store.record(command));
    expect(first).toEqual(duplicate);
    expect(first).toMatchObject({ accepted: true, resultingControlEpoch: 1, resultingControlState: "paused" });
    expect(await runWithTenant(scope, () => getJob(job.id))).toMatchObject({ controlState: "paused", controlEpoch: 1 });

    const resume = createCommandEnvelope({
      ...command,
      commandId: "resume-command-1",
      action: "resume",
      expectedControlEpoch: 1,
    });
    const resumed = await runWithTenant(scope, () => store.record(resume));
    expect(resumed).toMatchObject({ accepted: true, resultingControlEpoch: 2, resultingControlState: "running" });
    const resumeOutboxes = await runWithTenant(scope, () => listDispatchableStageOutbox());
    expect(resumeOutboxes.filter((record) => record.jobId === job.id && record.attempt === 2)).toHaveLength(1);
    expect(await runWithTenant(scope, () => store.record(resume))).toEqual(resumed);
    expect((await runWithTenant(scope, () => listDispatchableStageOutbox())).filter((record) => record.jobId === job.id && record.attempt === 2)).toHaveLength(1);

    const conflicting = createCommandEnvelope({ ...command, action: "cancel", confirmation: `CANCEL ${job.id}` });
    await expect(runWithTenant(scope, () => store.record(conflicting))).rejects.toThrow("different payload");

    const action = { id: "inflight-action", jobId: job.id, type: "publish_x_post" as const, title: "Publish", description: "", risk: "high" as const, requiresApproval: true, approvalState: "approved" as const, payload: { text: "in flight" }, state: "planned" as const };
    await db().doc(`workspaces/${workspaceId}/jobs/${job.id}`).update({ actions: [action] });
    await db().doc(`workspaces/${workspaceId}/jobs/${job.id}/approval_decisions/${action.id}`).set({ id: "inflight-approval", jobId: job.id, actionId: action.id, decision: "approved", payloadDigest: actionPayloadDigest(action), actorType: "firebase_operator", actorSubjectId: "user-test", authenticationId: "firebase-test", channel: "dashboard", operationId: `${job.id}:approval:${action.id}`, traceId: "f".repeat(32), decidedAt: new Date().toISOString() });
    const effectInput: EffectCommandInput = { id: "inflight-command", workspaceId, brandId: scope.brandId, sourceKind: "job_action", sourceId: action.id, jobId: job.id, actionId: action.id, actionType: action.type, payload: action.payload, authorization: { kind: "approval", approvalId: "inflight-approval", approvedPayloadDigest: "pending" } };
    const effect = createEffectCommand({ ...effectInput, authorization: { kind: "approval", approvalId: "inflight-approval", approvedPayloadDigest: effectCommandDigest(effectInput) } });
    await runWithTenant(scope, () => createCommand(effect));
    await runWithTenant(scope, () => claimCommandEffect(effect.id, { operationId: `job:${job.id}:effect:${effect.id}`, traceId: "f".repeat(32), claimToken: "inflight-owner" }));
    const cancellation = createCommandEnvelope({ commandId: "cancel-inflight", jobId: job.id, action: "cancel", expectedControlEpoch: 2, confirmation: `CANCEL ${job.id}`, actor: command.actor, receivedAt: "2026-08-31T00:02:00.000Z" });
    expect(await runWithTenant(scope, () => store.record(cancellation))).toMatchObject({ accepted: true, resultingControlState: "cancelled" });
    expect(await runWithTenant(scope, () => getJob(job.id))).toMatchObject({ status: "failed", terminalOutcome: "unresolved", actions: [{ id: action.id, state: "planned" }] });
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${workspaceId}`));
  });
});
