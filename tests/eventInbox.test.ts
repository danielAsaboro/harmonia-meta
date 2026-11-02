import { describe, expect, it } from "vitest";

import {
  claimEventInbox,
  completeEventInbox,
  eventInboxKey,
  eventPayloadDigest,
  type EventEnvelope,
} from "@/lib/eventInbox";

const envelope: EventEnvelope = {
  schemaVersion: 1,
  source: "stage_outbox",
  sourceEventId: "stage-outbox:outbox-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  jobId: "job-1",
  eventType: "stage.requested",
  operationId: "job:job-1:stage:understand",
  correlationId: "job:job-1",
  attempt: 0,
  trust: "system",
  occurredAt: "2026-08-28T12:00:00.000Z",
  payload: { stage: "understand" },
  payloadDigest: eventPayloadDigest({ stage: "understand" }),
};

const input = {
  envelope,
  pubsubMessageId: "delivery-1",
  ownerTokenDigest: "a".repeat(64),
  now: "2026-08-28T12:01:00.000Z",
  claimUntil: "2026-08-28T12:06:00.000Z",
  replayPolicy: "safe" as const,
};

describe("event inbox identity and validation", () => {
  it("uses an unambiguous canonical source identity", () => {
    expect(eventInboxKey("stage_outbox", "stage-outbox:outbox-1"))
      .toMatch(/^[a-f0-9]{64}$/);
    expect(eventInboxKey("ab", "c")).not.toBe(eventInboxKey("a", "bc"));
  });

  it("canonicalizes payload objects before hashing", () => {
    expect(eventPayloadDigest({ stage: "understand", attempt: 0 }))
      .toBe(eventPayloadDigest({ attempt: 0, stage: "understand" }));
  });

  it("rejects an envelope whose payload no longer matches its digest", () => {
    expect(() => claimEventInbox(null, {
      ...input,
      envelope: { ...envelope, payload: { stage: "draft" } },
    })).toThrow("event payload digest mismatch");
  });
});

describe("event inbox claims", () => {
  it("accepts one domain event and records delivery evidence", () => {
    const result = claimEventInbox(null, input);
    expect(result).toMatchObject({
      outcome: "execute",
      record: {
        state: "processing",
        deliveryAttempts: 1,
        pubsubMessageIds: ["delivery-1"],
        operationId: envelope.operationId,
      },
    });
  });

  it("collapses duplicate active and completed deliveries", () => {
    const processing = claimEventInbox(null, input).record;
    const duplicate = claimEventInbox(processing, {
      ...input,
      pubsubMessageId: "delivery-2",
      now: "2026-08-28T12:02:00.000Z",
      claimUntil: "2026-08-28T12:07:00.000Z",
    });
    expect(duplicate.outcome).toBe("in_progress");
    expect(duplicate.record.pubsubMessageIds).toEqual(["delivery-1", "delivery-2"]);

    const completed = completeEventInbox(processing, input.ownerTokenDigest, {
      outcome: "completed",
      now: "2026-08-28T12:03:00.000Z",
    });
    expect(claimEventInbox(completed, {
      ...input,
      pubsubMessageId: "delivery-3",
      now: "2026-08-28T12:04:00.000Z",
      claimUntil: "2026-08-28T12:09:00.000Z",
    }).outcome).toBe("already_completed");
  });

  it("reclaims only safe expired processing and preserves the stable event key", () => {
    const processing = claimEventInbox(null, {
      ...input,
      claimUntil: "2026-08-28T12:02:00.000Z",
    }).record;
    const reclaimed = claimEventInbox(processing, {
      ...input,
      pubsubMessageId: "delivery-2",
      ownerTokenDigest: "b".repeat(64),
      now: "2026-08-28T12:03:00.000Z",
      claimUntil: "2026-08-28T12:08:00.000Z",
    });
    expect(reclaimed).toMatchObject({
      outcome: "execute",
      record: { id: processing.id, deliveryAttempts: 2, ownerTokenDigest: "b".repeat(64) },
    });

    const blocked = claimEventInbox(processing, {
      ...input,
      pubsubMessageId: "delivery-3",
      now: "2026-08-28T12:03:00.000Z",
      claimUntil: "2026-08-28T12:08:00.000Z",
      replayPolicy: "reconcile",
    });
    expect(blocked).toMatchObject({ outcome: "rejected", record: { state: "rejected" } });
  });

  it("rejects a duplicate source identity with changed payload", () => {
    const existing = claimEventInbox(null, input).record;
    const changed = {
      ...envelope,
      payload: { stage: "draft" },
      payloadDigest: eventPayloadDigest({ stage: "draft" }),
    };
    expect(() => claimEventInbox(existing, { ...input, envelope: changed }))
      .toThrow("event identity conflict");
  });

  it("finalizes only for the claim owner", () => {
    const processing = claimEventInbox(null, input).record;
    expect(() => completeEventInbox(processing, "wrong", {
      outcome: "completed", now: "2026-08-28T12:03:00.000Z",
    })).toThrow("event inbox claim token mismatch");
  });
});
