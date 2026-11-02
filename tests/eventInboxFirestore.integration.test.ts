import { afterAll, describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import {
  claimDurableEvent,
  claimDurableOperation,
  completeDurableEvent,
  db,
  getDurableEvent,
  getDurableOperation,
} from "@/lib/firestore";
import { eventPayloadDigest, type EventEnvelope } from "@/lib/eventInbox";
import { operationIdForStage } from "@/lib/operations";
import { runWithTenant } from "@/lib/tenancy";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const workspaceId = `event-inbox-test-${Date.now()}`;
const scope = {
  workspaceId,
  brandId: "brand-test",
  principal: servicePrincipal("event-inbox-integration"),
};
const operationId = operationIdForStage("job-1", "understand");
const envelope: EventEnvelope = {
  schemaVersion: 1,
  source: "stage_outbox",
  sourceEventId: "stage-outbox:outbox-1",
  workspaceId,
  brandId: scope.brandId,
  jobId: "job-1",
  eventType: "stage.requested",
  operationId,
  correlationId: "job:job-1",
  attempt: 0,
  trust: "system",
  occurredAt: "2026-08-28T12:00:00.000Z",
  payload: { stage: "understand" },
  payloadDigest: eventPayloadDigest({ stage: "understand" }),
};

describe.skipIf(!emulator)("event inbox Firestore transaction", () => {
  it("accepts a source event once and creates its operation atomically", async () => {
    const claimInput = {
      envelope,
      pubsubMessageId: "delivery-1",
      ownerTokenDigest: "a".repeat(64),
      now: "2026-08-28T12:01:00.000Z",
      claimUntil: "2026-08-28T12:06:00.000Z",
      replayPolicy: "safe" as const,
      operation: {
        id: operationId,
        workspaceId,
        brandId: scope.brandId,
        jobId: "job-1",
        kind: "stage" as const,
        goal: { type: "run_stage", version: 1, digest: "b".repeat(64), acceptance: ["persist result"] },
        correlationId: "job:job-1",
        replayPolicy: "safe" as const,
        maxAttempts: 3,
        now: "2026-08-28T12:01:00.000Z",
      },
    };
    const outcomes = await runWithTenant(scope, () => Promise.all([
      claimDurableEvent(claimInput),
      claimDurableEvent({ ...claimInput, pubsubMessageId: "delivery-2" }),
    ]));
    expect(outcomes.map((result) => result.outcome).sort()).toEqual(["execute", "in_progress"]);
    expect(await runWithTenant(scope, () => getDurableOperation(operationId))).not.toBeNull();

    await runWithTenant(scope, () => claimDurableOperation(operationId, {
      ownerId: "worker-1",
      ownerTokenDigest: "c".repeat(64),
      now: "2026-08-28T12:02:00.000Z",
      leaseExpiresAt: "2026-08-28T12:07:00.000Z",
    }));

    await runWithTenant(scope, () => completeDurableEvent(envelope.source, envelope.sourceEventId, {
      ownerTokenDigest: "a".repeat(64),
      outcome: "completed",
      now: "2026-08-28T12:03:00.000Z",
      operationId,
      operationEpoch: 1,
      operationState: "succeeded",
    }));
    expect(await runWithTenant(scope, () => getDurableEvent(envelope.source, envelope.sourceEventId)))
      .toMatchObject({ state: "completed" });
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${workspaceId}`));
  });
});
