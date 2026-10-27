import { createHash } from "node:crypto";

import { canonicalJson } from "../recordReplay/integrity";
import { dataWorkItemSchema, type DataWorkItem } from "./contracts";

export type { DataWorkItem } from "./contracts";

export interface WorkItemClaimInput {
  ownerId: string;
  ownerTokenDigest: string;
  now: string;
  leaseExpiresAt: string;
}

export type WorkItemClaimResult = {
  outcome: "execute" | "in_progress" | "already_succeeded" | "dead_lettered" | "cancelled";
  item: DataWorkItem;
};

export interface WorkItemFinalizeInput {
  epoch: number;
  ownerTokenDigest: string;
  outcome: "succeeded" | "failed" | "cancelled";
  artifactIds: string[];
  failureCode?: string;
  now: string;
}

function timestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid ${field}`);
  return parsed;
}

function withoutLease(item: DataWorkItem): DataWorkItem {
  const next = { ...item };
  delete next.ownerId;
  delete next.ownerTokenDigest;
  delete next.leaseExpiresAt;
  return next;
}

export function deterministicWorkItemId(input: {
  batchId: string;
  sourceDigest: string;
  partitionIndex: number;
  processorVersion: string;
}): string {
  if (!input.batchId || !/^[a-f0-9]{64}$/.test(input.sourceDigest)) throw new Error("invalid work item identity");
  if (!Number.isInteger(input.partitionIndex) || input.partitionIndex < 0) throw new Error("invalid partition index");
  if (!input.processorVersion) throw new Error("invalid processor version");
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function claimWorkItem(current: DataWorkItem, input: WorkItemClaimInput): WorkItemClaimResult {
  const item = dataWorkItemSchema.parse(current);
  const now = timestamp(input.now, "claim time");
  const leaseExpiresAt = timestamp(input.leaseExpiresAt, "lease expiry");
  if (leaseExpiresAt <= now) throw new Error("work item lease must expire after claim time");
  if (!input.ownerId || !/^[a-f0-9]{64}$/.test(input.ownerTokenDigest)) throw new Error("work item owner is invalid");
  if (item.state === "succeeded") return { outcome: "already_succeeded", item };
  if (item.state === "dead_lettered") return { outcome: "dead_lettered", item };
  if (item.state === "cancelled") return { outcome: "cancelled", item };
  if (item.state === "claimed" && item.leaseExpiresAt && timestamp(item.leaseExpiresAt, "existing lease") > now) {
    return { outcome: "in_progress", item };
  }
  if (item.attempt >= item.maxAttempts) {
    const dead = dataWorkItemSchema.parse(withoutLease({
      ...item,
      state: "dead_lettered",
      failureCode: item.failureCode ?? "attempt_budget_exhausted",
      updatedAt: input.now,
      finalizedAt: input.now,
    }));
    return { outcome: "dead_lettered", item: dead };
  }
  const claimed = dataWorkItemSchema.parse({
    ...item,
    state: "claimed",
    attempt: item.attempt + 1,
    epoch: item.epoch + 1,
    ownerId: input.ownerId,
    ownerTokenDigest: input.ownerTokenDigest,
    leaseExpiresAt: input.leaseExpiresAt,
    updatedAt: input.now,
  });
  return { outcome: "execute", item: claimed };
}

export function finalizeWorkItem(current: DataWorkItem, input: WorkItemFinalizeInput): DataWorkItem {
  const item = dataWorkItemSchema.parse(current);
  timestamp(input.now, "finalization time");
  if (item.state !== "claimed") throw new Error(`work item is ${item.state}`);
  if (item.epoch !== input.epoch) throw new Error("work item epoch mismatch");
  if (item.ownerTokenDigest !== input.ownerTokenDigest) throw new Error("work item owner mismatch");
  if (input.outcome === "succeeded" && input.artifactIds.length === 0) throw new Error("successful work item requires an artifact");
  const state = input.outcome === "failed" && item.attempt >= item.maxAttempts ? "dead_lettered" : input.outcome;
  return dataWorkItemSchema.parse(withoutLease({
    ...item,
    state,
    artifactIds: [...new Set(input.artifactIds)],
    ...(input.failureCode ? { failureCode: input.failureCode } : {}),
    updatedAt: input.now,
    finalizedAt: input.now,
  }));
}

export function selectDispatchableItems(
  items: DataWorkItem[],
  input: { now: string; maxInFlight: number },
): DataWorkItem[] {
  const now = timestamp(input.now, "dispatch time");
  if (!Number.isInteger(input.maxInFlight) || input.maxInFlight < 1 || input.maxInFlight > 100) throw new Error("maxInFlight must be between 1 and 100");
  const parsed = items.map((item) => dataWorkItemSchema.parse(item));
  const visibilityCutoff = now - 60_000;
  const active = parsed.filter((item) => (item.state === "claimed" && item.leaseExpiresAt && Date.parse(item.leaseExpiresAt) > now)
    || (["pending", "failed"].includes(item.state) && item.lastDispatchedAt && Date.parse(item.lastDispatchedAt) > visibilityCutoff)).length;
  const available = Math.max(0, input.maxInFlight - active);
  return parsed
    .filter((item) => (["pending", "failed"].includes(item.state) && (!item.lastDispatchedAt || Date.parse(item.lastDispatchedAt) <= visibilityCutoff))
      || (item.state === "claimed" && item.leaseExpiresAt && Date.parse(item.leaseExpiresAt) <= now))
    .sort((left, right) => left.partitionIndex - right.partitionIndex || left.id.localeCompare(right.id))
    .slice(0, available);
}
