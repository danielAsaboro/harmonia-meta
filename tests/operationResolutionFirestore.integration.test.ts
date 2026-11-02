import { afterAll, describe, expect, it } from "vitest";

import { firebasePrincipal } from "@/lib/authority";
import { createArtifactRecord } from "@/lib/artifacts";
import { createEffectCommand, effectCommandDigest, markEffectDispatched, markEffectUnknown, type EffectCommandInput } from "@/lib/effectCommands";
import { db, getDurableOperation, getJob, listReceipts } from "@/lib/firestore";
import { createOperation } from "@/lib/operations";
import { resolveUnknownOperation } from "@/lib/operationResolution";
import { runWithTenant, tenantCollectionPath } from "@/lib/tenancy";
import type { EffectClaim, PlannedAction } from "@/lib/types";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const now = "2026-08-28T12:00:00.000Z";
const scope = {
  workspaceId: "resolution-test", brandId: "brand-test",
  principal: firebasePrincipal({ subjectId: "operator-1", workspaceRole: "owner", authenticationId: "session-1" }),
};

describe.skipIf(!emulator)("unknown effect operator resolution", () => {
  it("atomically binds evidence, resolution, receipt, command, claim, operation, and job", async () => {
    const jobId = `resolution-${Date.now()}`;
    const action: PlannedAction = {
      id: "action-1", jobId, type: "publish_x_post", title: "Post", description: "", risk: "high",
      requiresApproval: true, approvalState: "approved", payload: { text: "Launch" }, state: "planned",
    };
    const draft: EffectCommandInput = {
      id: "command-1", workspaceId: scope.workspaceId, brandId: scope.brandId,
      sourceKind: "job_action", sourceId: action.id, jobId, actionId: action.id,
      actionType: action.type, payload: action.payload,
      authorization: { kind: "approval", approvalId: "approval-1", approvedPayloadDigest: "pending" }, now,
    };
    const prepared = createEffectCommand({ ...draft, authorization: { kind: "approval", approvalId: "approval-1", approvedPayloadDigest: effectCommandDigest(draft) } });
    const operationId = `job:${jobId}:effect:${prepared.id}`;
    const dispatched = markEffectDispatched(prepared, { operationId, operationEpoch: 2, attempt: 1, now });
    const command = markEffectUnknown(dispatched, { operationId, operationEpoch: 2, reason: "provider response lost", now });
    const operation = { ...createOperation({
      id: operationId, workspaceId: scope.workspaceId, brandId: scope.brandId, jobId, kind: "effect",
      goal: { type: action.type, version: 1, digest: command.payloadDigest, acceptance: ["receipt"] },
      correlationId: `job:${jobId}`, replayPolicy: "reconcile", maxAttempts: 3, now,
    }), state: "unknown" as const, epoch: 2, attempt: 1, unresolvedReason: "provider response lost" };
    const claim: EffectClaim = {
      id: command.payloadDigest, jobId, actionId: action.id, actionType: action.type,
      idempotencyKey: command.payloadDigest, operationId, traceId: "b".repeat(32), claimToken: "dead-owner",
      state: "unknown", attempt: 1, claimedAt: now, leaseExpiresAt: now, operationEpoch: 2,
    };
    const artifact = {
      ...createArtifactRecord({
        id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d88", workspaceId: scope.workspaceId, brandId: scope.brandId,
        jobId, operationId, uri: "gs://evidence/x-readback.json", bytes: Buffer.from("provider account shows post-1"),
        contentType: "application/json", trust: "operator", producer: { kind: "operator", id: "dashboard", version: "1" },
        retentionClass: "audit", now,
      }), state: "ready" as const,
    };
    const jobPath = `${tenantCollectionPath(scope, "jobs")}/${jobId}`;
    const commandPath = `${tenantCollectionPath(scope, "effect_commands")}/${command.id}`;
    await Promise.all([
      db().doc(jobPath).set({
        workspaceId: scope.workspaceId, brandId: scope.brandId, createdByUserId: "operator-1",
        createdAt: now, updatedAt: now, status: "running", stage: "publish", config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] }, actions: [action],
      }),
      db().doc(`${tenantCollectionPath(scope, "operations")}/${operationId}`).set(operation),
      db().doc(commandPath).set(command),
      db().doc(`${tenantCollectionPath(scope, "artifacts")}/${artifact.id}`).set(artifact),
    ]);
    await db().doc(`${commandPath}/claims/effect`).set(claim);

    const request = {
      choice: "confirm_applied" as const, reason: "Official account readback confirms the post exists.", expectedEpoch: 2,
      evidence: [{ artifactId: artifact.id, digest: artifact.sha256 }],
    };
    const first = await runWithTenant(scope, () => resolveUnknownOperation(jobId, operationId, request, db()));
    const second = await runWithTenant(scope, () => resolveUnknownOperation(jobId, operationId, request, db()));
    expect(first.duplicate).toBe(false);
    expect(second).toMatchObject({ duplicate: true, resolution: { digest: first.resolution.digest } });
    const [storedOperation, storedJob, receipts, storedCommand, storedClaim] = await runWithTenant(scope, async () => Promise.all([
      getDurableOperation(operationId), getJob(jobId), listReceipts(jobId), db().doc(commandPath).get(), db().doc(`${commandPath}/claims/effect`).get(),
    ]));
    expect(storedOperation?.state).toBe("succeeded");
    expect(storedJob.actions[0].state).toBe("executed");
    expect(receipts).toHaveLength(1);
    expect(storedCommand.get("state")).toBe("applied");
    expect(storedClaim.data()).toMatchObject({ state: "applied", receiptId: receipts[0].id });
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${scope.workspaceId}`));
  });
});
