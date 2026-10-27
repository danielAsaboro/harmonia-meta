import { createHash } from "node:crypto";

import { canonicalJson } from "./recordReplay/integrity";
import type { ReplayPolicy } from "./operations";

export type EventTrust = "system" | "operator" | "provider" | "external_untrusted" | "model_inference";
export type EventInboxState = "accepted" | "processing" | "completed" | "rejected";

export interface EventEnvelope {
  schemaVersion: 1;
  source: string;
  sourceEventId: string;
  workspaceId: string;
  brandId: string;
  jobId: string;
  eventType: string;
  operationId: string;
  correlationId: string;
  causationId?: string;
  attempt: number;
  trust: EventTrust;
  occurredAt: string;
  payload: Record<string, unknown>;
  payloadDigest: string;
}

export interface EventInboxRecord {
  id: string;
  source: string;
  sourceEventId: string;
  schemaVersion: number;
  workspaceId: string;
  brandId: string;
  jobId: string;
  eventType: string;
  operationId: string;
  correlationId: string;
  causationId?: string;
  payloadDigest: string;
  trust: EventTrust;
  occurredAt: string;
  receivedAt: string;
  state: EventInboxState;
  replayPolicy: ReplayPolicy;
  deliveryAttempts: number;
  pubsubMessageIds: string[];
  ownerTokenDigest?: string;
  claimUntil?: string;
  completedAt?: string;
  rejectionReason?: string;
  updatedAt: string;
}

export interface EventInboxClaimInput {
  envelope: EventEnvelope;
  pubsubMessageId: string;
  ownerTokenDigest: string;
  now: string;
  claimUntil: string;
  replayPolicy: ReplayPolicy;
}

export type EventInboxClaimResult = {
  outcome: "execute" | "in_progress" | "already_completed" | "rejected";
  record: EventInboxRecord;
};

const MAX_DELIVERY_IDS = 32;

function timestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid ${label}`);
  return parsed;
}

function appendDelivery(record: EventInboxRecord, messageId: string, now: string): EventInboxRecord {
  const ids = record.pubsubMessageIds.includes(messageId)
    ? record.pubsubMessageIds
    : [...record.pubsubMessageIds, messageId].slice(-MAX_DELIVERY_IDS);
  return {
    ...record,
    deliveryAttempts: record.deliveryAttempts + 1,
    pubsubMessageIds: ids,
    updatedAt: now,
  };
}

function withoutClaim(record: EventInboxRecord): EventInboxRecord {
  const next = { ...record };
  delete next.ownerTokenDigest;
  delete next.claimUntil;
  return next;
}

function assertEnvelope(envelope: EventEnvelope): void {
  timestamp(envelope.occurredAt, "event occurrence timestamp");
  if (envelope.schemaVersion !== 1) throw new Error("unsupported event schema version");
  if (!envelope.source || !envelope.sourceEventId || !envelope.operationId || !envelope.correlationId) {
    throw new Error("event identity is incomplete");
  }
  if (!Number.isInteger(envelope.attempt) || envelope.attempt < 0) {
    throw new Error("event attempt must be a non-negative integer");
  }
  if (eventPayloadDigest(envelope.payload) !== envelope.payloadDigest) {
    throw new Error("event payload digest mismatch");
  }
}

function assertSameEvent(record: EventInboxRecord, envelope: EventEnvelope): void {
  if (
    record.id !== eventInboxKey(envelope.source, envelope.sourceEventId)
    || record.source !== envelope.source
    || record.sourceEventId !== envelope.sourceEventId
    || record.workspaceId !== envelope.workspaceId
    || record.brandId !== envelope.brandId
    || record.jobId !== envelope.jobId
    || record.operationId !== envelope.operationId
    || record.payloadDigest !== envelope.payloadDigest
  ) {
    throw new Error("event identity conflict");
  }
}

export function eventInboxKey(source: string, sourceEventId: string): string {
  if (!source || !sourceEventId) throw new Error("event source identity is required");
  return createHash("sha256")
    .update(`${Buffer.byteLength(source, "utf8")}:${source}${Buffer.byteLength(sourceEventId, "utf8")}:${sourceEventId}`)
    .digest("hex");
}

export function eventPayloadDigest(payload: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex");
}

export function claimEventInbox(
  existing: EventInboxRecord | null,
  input: EventInboxClaimInput,
): EventInboxClaimResult {
  assertEnvelope(input.envelope);
  const now = timestamp(input.now, "event receipt timestamp");
  const claimUntil = timestamp(input.claimUntil, "event claim expiry");
  if (claimUntil <= now) throw new Error("event claim must expire after receipt time");
  if (!input.pubsubMessageId || !input.ownerTokenDigest) throw new Error("event delivery claim is incomplete");

  if (!existing) {
    return {
      outcome: "execute",
      record: {
        id: eventInboxKey(input.envelope.source, input.envelope.sourceEventId),
        source: input.envelope.source,
        sourceEventId: input.envelope.sourceEventId,
        schemaVersion: input.envelope.schemaVersion,
        workspaceId: input.envelope.workspaceId,
        brandId: input.envelope.brandId,
        jobId: input.envelope.jobId,
        eventType: input.envelope.eventType,
        operationId: input.envelope.operationId,
        correlationId: input.envelope.correlationId,
        ...(input.envelope.causationId ? { causationId: input.envelope.causationId } : {}),
        payloadDigest: input.envelope.payloadDigest,
        trust: input.envelope.trust,
        occurredAt: input.envelope.occurredAt,
        receivedAt: input.now,
        state: "processing",
        replayPolicy: input.replayPolicy,
        deliveryAttempts: 1,
        pubsubMessageIds: [input.pubsubMessageId],
        ownerTokenDigest: input.ownerTokenDigest,
        claimUntil: input.claimUntil,
        updatedAt: input.now,
      },
    };
  }

  assertSameEvent(existing, input.envelope);
  const delivered = appendDelivery(existing, input.pubsubMessageId, input.now);
  if (existing.state === "completed") return { outcome: "already_completed", record: delivered };
  if (existing.state === "rejected") return { outcome: "rejected", record: delivered };
  if (existing.state === "processing") {
    const existingExpiry = timestamp(existing.claimUntil ?? "", "existing event claim expiry");
    if (existingExpiry > now) return { outcome: "in_progress", record: delivered };
    if (input.replayPolicy !== "safe" || existing.replayPolicy !== "safe") {
      return {
        outcome: "rejected",
        record: withoutClaim({
          ...delivered,
          state: "rejected",
          rejectionReason: "event claim expired under non-replayable policy",
          completedAt: input.now,
        }),
      };
    }
  }

  return {
    outcome: "execute",
    record: {
      ...delivered,
      state: "processing",
      ownerTokenDigest: input.ownerTokenDigest,
      claimUntil: input.claimUntil,
    },
  };
}

export function completeEventInbox(
  current: EventInboxRecord,
  ownerTokenDigest: string,
  input: { outcome: "completed" | "rejected"; now: string; rejectionReason?: string },
): EventInboxRecord {
  timestamp(input.now, "event completion timestamp");
  if (current.state === "completed" && input.outcome === "completed") return current;
  if (current.state !== "processing") throw new Error(`event inbox record is ${current.state}`);
  if (current.ownerTokenDigest !== ownerTokenDigest) throw new Error("event inbox claim token mismatch");
  if (input.outcome === "rejected" && !input.rejectionReason) {
    throw new Error("rejected event requires a reason");
  }
  return withoutClaim({
    ...current,
    state: input.outcome,
    updatedAt: input.now,
    completedAt: input.now,
    ...(input.rejectionReason ? { rejectionReason: input.rejectionReason } : {}),
  });
}
