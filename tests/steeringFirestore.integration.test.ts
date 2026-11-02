import { afterAll, describe, expect, it } from "vitest";
import { claimJobStageExecution, createJob, db, transitionStageWithOutbox } from "@/lib/firestore";
import { createCommand, getCommand } from "@/lib/effectCommandStore";
import { createEffectCommand, effectCommandDigest, type EffectCommandInput } from "@/lib/effectCommands";
import { applyNudge, proposeNudge, redoJobStage } from "@/lib/steering/repository";
import { runWithTenant } from "@/lib/tenancy";
import { servicePrincipal } from "@/lib/authority";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const scope = { workspaceId: `steering-${Date.now()}`, brandId: "brand-1", principal: servicePrincipal("steering-test") };
const root = `workspaces/${scope.workspaceId}`;

describe.skipIf(!emulator)("durable steering transactions", () => {
  const jobId = "job-safe";

  it("atomically rewinds state and creates an epoch-specific pending outbox", async () => {
    await db().doc(`${root}/jobs/${jobId}`).set({
      id: jobId, workspaceId: scope.workspaceId, brandId: scope.brandId,
      createdByUserId: "operator-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      status: "running", stage: "awaiting_approval", controlEpoch: 2, controlState: "running",
      config: { platforms: [] }, actions: [{ id: "a1", jobId, type: "publish_x_post", title: "Publish", description: "", risk: "high", requiresApproval: true, payload: { text: "approved" }, state: "planned", approvalState: "approved" }],
    });
    const commandInput: EffectCommandInput = { id: "steering-command", workspaceId: scope.workspaceId, brandId: scope.brandId, sourceKind: "job_action", sourceId: "a1", jobId, actionId: "a1", actionType: "publish_x_post", payload: { text: "approved" }, authorization: { kind: "approval", approvalId: "approval-a1", approvedPayloadDigest: "pending" } };
    await runWithTenant(scope, () => createCommand(createEffectCommand({ ...commandInput, authorization: { kind: "approval", approvalId: "approval-a1", approvedPayloadDigest: effectCommandDigest(commandInput) } })));
    const dispatch = await runWithTenant(scope, () => redoJobStage(jobId, 2, "draft", "REDO draft"));
    const [job, outbox] = await Promise.all([
      db().doc(`${root}/jobs/${jobId}`).get(), db().doc(`${root}/stage_outbox/${dispatch.outboxId}`).get(),
    ]);
    expect(dispatch.controlEpoch).toBe(3);
    expect(job.data()).toMatchObject({ stage: "draft", controlEpoch: 3, status: "running" });
    expect((job.get("actions") as Array<{ approvalState: string }>)[0].approvalState).toBe("pending");
    expect(outbox.data()).toMatchObject({ jobId, stage: "draft", attempt: 3, state: "pending" });
    expect(await runWithTenant(scope, () => getCommand("steering-command"))).toMatchObject({ state: "cancelled" });
    expect(await runWithTenant(scope, () => claimJobStageExecution({ jobId, stage: "draft", operationId: String(outbox.get("operationId")), ownerId: "redo-worker", claimToken: "r".repeat(32) }))).toMatchObject({ outcome: "execute" });
    await expect(runWithTenant(scope, () => redoJobStage(jobId, 2, "draft", "REDO draft"))).rejects.toThrow("stale steering epoch");
  });

  it("applies a nudge through a new durable outbox", async () => {
    await db().doc(`${root}/jobs/${jobId}`).update({ stage: "awaiting_approval" });
    const proposed = await runWithTenant(scope, () => proposeNudge(jobId, { scope: "current_stage", instruction: "Use a more technical opening" }));
    const dispatch = await runWithTenant(scope, () => applyNudge(jobId, proposed.nudge.id, proposed.impact.digest));
    const [outbox, job] = await Promise.all([
      db().doc(`${root}/stage_outbox/${dispatch.outboxId}`).get(), db().doc(`${root}/jobs/${jobId}`).get(),
    ]);
    expect(outbox.data()).toMatchObject({ stage: "draft", attempt: 4, state: "pending" });
    expect(job.get("stage")).toBe("draft");
    expect(job.get("steeringInstructions")).toHaveLength(1);
    expect(dispatch.controlEpoch).toBe(4);
  });

  it("rejects cross-brand steering", async () => {
    const otherBrand = { ...scope, brandId: "brand-2" };
    await expect(runWithTenant(otherBrand, () => redoJobStage(jobId, 4, "draft", "REDO draft"))).rejects.toThrow("brand");
  });

  it("allocates a fresh generation when source resolution revisits a stage", async () => {
    const sourceJob = await runWithTenant(scope, () => createJob({ sourceManifestId: "manifest-source", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, "extract_sources"));
    await db().doc(`${root}/jobs/${sourceJob.id}`).update({ stage: "awaiting_source_resolution" });
    const outboxId = await runWithTenant(scope, () => transitionStageWithOutbox(sourceJob.id, "awaiting_source_resolution", "extract_sources", "operator retry"));
    const [job, outbox] = await Promise.all([db().doc(`${root}/jobs/${sourceJob.id}`).get(), db().doc(`${root}/stage_outbox/${outboxId}`).get()]);
    expect(job.data()).toMatchObject({ stage: "extract_sources", controlEpoch: 1 });
    expect(outbox.data()).toMatchObject({ stage: "extract_sources", attempt: 0, operationId: `job:${sourceJob.id}:stage:extract_sources:generation:1` });
  });

  it("rejects rewinds that would cross an executed effect", async () => {
    const unsafe = "job-unsafe";
    await db().doc(`${root}/jobs/${unsafe}`).set({
      id: unsafe, workspaceId: scope.workspaceId, brandId: scope.brandId,
      createdByUserId: "operator-1", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      status: "complete", stage: "complete", controlEpoch: 0, config: { platforms: [] },
      actions: [{ id: "published", state: "executed", approvalState: "approved" }],
    });
    await expect(runWithTenant(scope, () => redoJobStage(unsafe, 0, "draft", "REDO draft")))
      .rejects.toThrow("cannot redo across executed external effects");
  });

  afterAll(async () => { if (emulator) await db().recursiveDelete(db().doc(root)); });
});
