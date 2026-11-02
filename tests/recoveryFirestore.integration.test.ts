import { afterAll, describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import { createArtifactRecord } from "@/lib/artifacts";
import { createEffectCommand, effectCommandDigest, markEffectDispatched, markEffectObserved, type EffectCommandInput } from "@/lib/effectCommands";
import { db } from "@/lib/firestore";
import { claimOperation, createOperation } from "@/lib/operations";
import { runRecovery } from "@/lib/recoveryStore";
import { runWithTenant, tenantCollectionPath } from "@/lib/tenancy";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const scope = { workspaceId: "recovery-test", brandId: "brand-test", principal: servicePrincipal("recovery-integration") };
const expiredAt = "2026-08-28T10:00:00.000Z";

describe.skipIf(!emulator)("recovery Firestore controller", () => {
  it("atomically requeues safe work, quarantines ambiguous work, and emits bounded recovery records", async () => {
    const operationCollection = tenantCollectionPath(scope, "operations");
    const safe = claimOperation(createOperation({
      id: "job:job-safe:stage:draft", workspaceId: scope.workspaceId, brandId: scope.brandId,
      jobId: "job-safe", kind: "stage", goal: { type: "draft", version: 1, digest: "a".repeat(64), acceptance: ["persist"] },
      correlationId: "job:job-safe", replayPolicy: "safe", maxAttempts: 3, now: "2026-08-28T09:00:00.000Z",
    }), { ownerId: "dead", ownerTokenDigest: "b".repeat(64), now: "2026-08-28T09:01:00.000Z", leaseExpiresAt: expiredAt }).operation;
    const reconcile = claimOperation(createOperation({
      id: "job:job-effect:effect:command-old", workspaceId: scope.workspaceId, brandId: scope.brandId,
      jobId: "job-effect", kind: "effect", goal: { type: "publish", version: 1, digest: "c".repeat(64), acceptance: ["receipt"] },
      correlationId: "job:job-effect", replayPolicy: "reconcile", maxAttempts: 3, now: "2026-08-28T09:00:00.000Z",
    }), { ownerId: "dead", ownerTokenDigest: "d".repeat(64), now: "2026-08-28T09:01:00.000Z", leaseExpiresAt: expiredAt }).operation;
    await Promise.all([
      db().doc(`${operationCollection}/${safe.id}`).set(safe),
      db().doc(`${operationCollection}/${reconcile.id}`).set(reconcile),
      db().doc(`${tenantCollectionPath(scope, "event_inbox")}/inbox-1`).set({
        id: "inbox-1", workspaceId: scope.workspaceId, brandId: scope.brandId, jobId: "job-inbox",
        state: "processing", replayPolicy: "safe", deliveryAttempts: 1, claimUntil: expiredAt,
        sourceEventId: "stage-outbox:source-outbox", operationId: safe.id,
      }),
      db().doc(`${tenantCollectionPath(scope, "stage_outbox")}/source-outbox`).set({
        id: "source-outbox", workspaceId: scope.workspaceId, brandId: scope.brandId, jobId: "job-inbox",
        state: "published", publishAttempt: 1, operationId: safe.id,
        sourceEventId: "stage-outbox:source-outbox", pubsubMessageId: "lost-message",
      }),
      db().doc(`${tenantCollectionPath(scope, "stage_outbox")}/outbox-1`).set({
        id: "outbox-1", workspaceId: scope.workspaceId, brandId: scope.brandId, jobId: "job-outbox",
        state: "claimed", publishAttempt: 1, claimUntil: expiredAt, operationId: "job:job-outbox:stage:draft",
      }),
    ]);

    const draft: EffectCommandInput = {
      id: "command-observed", workspaceId: scope.workspaceId, brandId: scope.brandId,
      sourceKind: "job_action", sourceId: "action-1", jobId: "job-observed", actionId: "action-1",
      actionType: "publish_x_post", payload: { text: "Launch" },
      authorization: { kind: "approval", approvalId: "approval-1", approvedPayloadDigest: "pending" },
      now: "2026-08-28T09:00:00.000Z",
    };
    const prepared = createEffectCommand({ ...draft, authorization: { kind: "approval", approvalId: "approval-1", approvedPayloadDigest: effectCommandDigest(draft) } });
    const dispatched = markEffectDispatched(prepared, {
      operationId: "job:job-observed:effect:command-observed", operationEpoch: 1, attempt: 1, now: "2026-08-28T09:01:00.000Z",
    });
    const observed = markEffectObserved(dispatched, {
      operationId: dispatched.operationId!, operationEpoch: 1, outcome: "applied", detail: { id: "post-1" }, now: "2026-08-28T09:02:00.000Z",
    });
    const artifact = {
      ...createArtifactRecord({
        id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d77", workspaceId: scope.workspaceId, brandId: scope.brandId,
        jobId: "job-artifact", operationId: safe.id, uri: "memory://artifact", bytes: Buffer.from("data"),
        contentType: "text/plain", trust: "system", producer: { kind: "runtime", id: "test", version: "1" },
        retentionClass: "audit", now: "2026-08-28T09:00:00.000Z",
      }), state: "failed" as const, failureReason: "write interrupted",
    };
    await Promise.all([
      db().doc(`${tenantCollectionPath(scope, "effect_commands")}/${observed.id}`).set(observed),
      db().doc(`${tenantCollectionPath(scope, "artifacts")}/${artifact.id}`).set(artifact),
      db().doc(`${tenantCollectionPath(scope, "jobs")}/job-receipt`).set({
        id: "job-receipt", workspaceId: scope.workspaceId, brandId: scope.brandId,
        stage: "verify", verifications: [],
      }),
      db().doc(`${tenantCollectionPath(scope, "jobs")}/job-receipt/receipts/receipt-1`).set({
        id: "receipt-1", jobId: "job-receipt", operationId: "operation-receipt-1",
        status: "applied", createdAt: "2026-08-28T09:03:00.000Z",
      }),
    ]);

    const result = await runWithTenant(scope, () => runRecovery({
      limit: 20, deadlineSeconds: 15, maxRetries: 3, maxCostUsd: "1.000000",
    }, db()));
    expect(result.actions.map((item) => item.action)).toEqual(expect.arrayContaining([
      "replay_operation", "reconcile_operation", "requeue_event", "requeue_outbox",
      "finalize_observed_effect", "blocked_artifact", "enqueue_verification",
    ]));
    expect(result.actions.every((item) => item.emitted)).toBe(true);
    const [safeAfter, reconcileAfter, inboxAfter, outboxAfter, sourceOutboxAfter, recoveryWork] = await Promise.all([
      db().doc(`${operationCollection}/${safe.id}`).get(),
      db().doc(`${operationCollection}/${reconcile.id}`).get(),
      db().doc(`${tenantCollectionPath(scope, "event_inbox")}/inbox-1`).get(),
      db().doc(`${tenantCollectionPath(scope, "stage_outbox")}/outbox-1`).get(),
      db().doc(`${tenantCollectionPath(scope, "stage_outbox")}/source-outbox`).get(),
      db().collection(tenantCollectionPath(scope, "recovery_work")).get(),
    ]);
    expect(safeAfter.get("state")).toBe("waiting");
    expect(reconcileAfter.get("state")).toBe("unknown");
    expect(inboxAfter.get("state")).toBe("accepted");
    expect(outboxAfter.get("state")).toBe("pending");
    expect(sourceOutboxAfter.get("state")).toBe("pending");
    expect(sourceOutboxAfter.get("pubsubMessageId")).toBeUndefined();
    expect(recoveryWork.size).toBe(result.actions.length);
    const replay = await runWithTenant(scope, () => runRecovery({
      limit: 20, deadlineSeconds: 15, maxRetries: 3, maxCostUsd: "1.000000",
    }, db()));
    expect(replay.actions).toHaveLength(3);
    expect(replay.actions.every((item) => !item.emitted)).toBe(true);

    const secondClaim = claimOperation(safeAfter.data() as typeof safe, {
      ownerId: "replacement-worker", ownerTokenDigest: "e".repeat(64),
      now: "2026-08-28T10:01:00.000Z", leaseExpiresAt: "2026-08-28T10:02:00.000Z",
    }).operation;
    await safeAfter.ref.set(secondClaim);
    const laterCrash = await runWithTenant(scope, () => runRecovery({
      limit: 20, deadlineSeconds: 15, maxRetries: 3, maxCostUsd: "1.000000",
    }, db()));
    const laterReplay = laterCrash.actions.find((item) => item.candidateId === `operation:${safe.id}`);
    expect(laterReplay).toMatchObject({ action: "replay_operation", emitted: true });
    expect((await safeAfter.ref.get()).get("state")).toBe("waiting");
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${scope.workspaceId}`));
  });
});
