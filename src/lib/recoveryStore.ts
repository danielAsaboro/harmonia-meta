import { FieldValue, type Firestore } from "@google-cloud/firestore";

import { db } from "./firestore";
import { planRecovery, type RecoveryAction, type RecoveryBounds, type RecoveryCandidate } from "./recovery";
import { currentTenant, tenantCollectionPath } from "./tenancy";
import type { EffectCommand } from "./effectCommands";
import type { EventInboxRecord } from "./eventInbox";
import type { OperationRecord } from "./operations";
import type { StageOutboxRecord } from "./stageOutbox";
import type { ArtifactRecord } from "./artifacts";
import type { Job, Receipt, VerificationResult } from "./types";

const COLLECTIONS = {
  operations: "operations", inbox: "event_inbox", outbox: "stage_outbox",
  commands: "effect_commands", artifacts: "artifacts", jobs: "jobs",
  recovery: "recovery_work",
} as const;

function collection(database: Firestore, name: string) {
  return database.collection(tenantCollectionPath(currentTenant(), name));
}

function assertTenant(value: { workspaceId: string; brandId: string }): void {
  const tenant = currentTenant();
  if (value.workspaceId !== tenant.workspaceId || value.brandId !== tenant.brandId) {
    throw new Error("recovery resource tenant mismatch");
  }
}

function assertTenantResourcePath(resourcePath: string): void {
  const tenant = currentTenant();
  if (!resourcePath.startsWith(`workspaces/${tenant.workspaceId}/`)) {
    throw new Error("recovery resource tenant mismatch");
  }
}

function receiptJobPath(resourcePath: string): string {
  assertTenantResourcePath(resourcePath);
  const match = resourcePath.match(/^(workspaces\/[^/]+\/jobs\/[^/]+)\/receipts\/[^/]+$/);
  if (!match) throw new Error("invalid recovery receipt path");
  return match[1];
}

function baseCandidate(
  kind: RecoveryCandidate["kind"], id: string, value: { workspaceId: string; brandId: string; jobId: string },
  state: string, replayPolicy: RecoveryCandidate["replayPolicy"], resourcePath: string,
): RecoveryCandidate {
  assertTenant(value);
  return {
    id: `${kind}:${id}`, kind, workspaceId: value.workspaceId, brandId: value.brandId,
    jobId: value.jobId, state, replayPolicy, retryCount: 0,
    estimatedCostUsd: "0.000000", resourcePath,
  };
}

export async function scanRecoveryCandidates(
  database: Firestore,
  input: { now: string; limit: number },
): Promise<RecoveryCandidate[]> {
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) throw new Error("recovery scan limit must be between 1 and 100");
  const nowMs = Date.parse(input.now);
  if (!Number.isFinite(nowMs)) throw new Error("invalid recovery scan timestamp");
  const candidates: RecoveryCandidate[] = [];
  const remaining = () => Math.max(0, input.limit - candidates.length);

  const operations = await collection(database, COLLECTIONS.operations).where("state", "==", "claimed").limit(input.limit).get();
  for (const doc of operations.docs) {
    if (!remaining()) break;
    const value = doc.data() as OperationRecord;
    if (Date.parse(value.leaseExpiresAt ?? "") > nowMs) continue;
    candidates.push({
      ...baseCandidate("operation", doc.id, value, value.state, value.replayPolicy, doc.ref.path),
      retryCount: value.attempt, leaseExpiresAt: value.leaseExpiresAt, operationId: value.id,
    });
  }

  if (remaining()) {
    const inbox = await collection(database, COLLECTIONS.inbox).where("state", "==", "processing").limit(remaining()).get();
    for (const doc of inbox.docs) {
      const value = doc.data() as EventInboxRecord;
      if (Date.parse(value.claimUntil ?? "") > nowMs) continue;
      candidates.push({
        ...baseCandidate("event_inbox", doc.id, value, value.state, value.replayPolicy, doc.ref.path),
        retryCount: value.deliveryAttempts, leaseExpiresAt: value.claimUntil, operationId: value.operationId,
      });
    }
  }

  if (remaining()) {
    const outbox = await collection(database, COLLECTIONS.outbox).where("state", "==", "claimed").limit(remaining()).get();
    for (const doc of outbox.docs) {
      const value = doc.data() as StageOutboxRecord;
      if (Date.parse(value.claimUntil ?? "") > nowMs) continue;
      candidates.push({
        ...baseCandidate("stage_outbox", doc.id, value, value.state, "safe", doc.ref.path),
        retryCount: value.publishAttempt, leaseExpiresAt: value.claimUntil, operationId: value.operationId,
      });
    }
  }

  if (remaining()) {
    const effects = await collection(database, COLLECTIONS.commands).where("state", "in", ["dispatched", "observed", "unknown"]).limit(remaining()).get();
    for (const doc of effects.docs) {
      const value = doc.data() as EffectCommand;
      assertTenant(value);
      const operationId = value.operationId;
      if (!operationId) continue;
      const operation = await collection(database, COLLECTIONS.operations).doc(operationId).get();
      const operationValue = operation.exists ? operation.data() as OperationRecord : null;
      const due = value.state === "observed" || value.state === "unknown"
        || (operationValue?.state === "claimed" && Date.parse(operationValue.leaseExpiresAt ?? "") <= nowMs);
      if (!due) continue;
      candidates.push({
        ...baseCandidate("effect", doc.id, value, value.state, "reconcile", doc.ref.path),
        retryCount: value.dispatchAttempt ?? 0, operationId,
        ...(operationValue?.leaseExpiresAt ? { leaseExpiresAt: operationValue.leaseExpiresAt } : {}),
      });
      if (!remaining()) break;
    }
  }

  if (remaining()) {
    const artifacts = await collection(database, COLLECTIONS.artifacts).where("state", "in", ["writing", "failed"]).limit(remaining()).get();
    for (const doc of artifacts.docs) {
      const value = doc.data() as ArtifactRecord;
      candidates.push({
        ...baseCandidate("artifact", doc.id, value, value.state, "never", doc.ref.path),
        artifactId: value.id,
      });
    }
  }

  if (remaining()) {
    const jobs = await collection(database, COLLECTIONS.jobs).limit(Math.min(remaining(), 20)).get();
    for (const jobDoc of jobs.docs) {
      const job = jobDoc.data() as Job & { verifications?: VerificationResult[] };
      assertTenant(job);
      const verifiedReceipts = new Set((job.verifications ?? []).map((item) => item.receiptId));
      const receipts = await jobDoc.ref.collection("receipts").limit(remaining()).get();
      for (const receiptDoc of receipts.docs) {
        const receipt = receiptDoc.data() as Receipt;
        if (verifiedReceipts.has(receipt.id)) continue;
        candidates.push({
          ...baseCandidate("receipt", receipt.id, { ...job, jobId: jobDoc.id }, "unverified", "safe", receiptDoc.ref.path),
          receiptId: receipt.id, operationId: receipt.operationId,
        });
        if (!remaining()) break;
      }
      if (!remaining()) break;
    }
  }
  return candidates.slice(0, input.limit);
}

function recoveryRecord(action: RecoveryAction, bounds: RecoveryBounds) {
  const tenant = currentTenant();
  return {
    ...action, workspaceId: tenant.workspaceId, brandId: tenant.brandId,
    state: "pending", createdAt: bounds.now, deadline: bounds.deadline,
    schemaVersion: 1,
  };
}

export async function applyRecoveryPlan(
  database: Firestore,
  actions: RecoveryAction[],
  bounds: RecoveryBounds,
): Promise<Array<RecoveryAction & { emitted: boolean }>> {
  const work = collection(database, COLLECTIONS.recovery);
  return database.runTransaction(async (tx) => {
    actions.forEach((action) => {
      if (action.resourcePath) assertTenantResourcePath(action.resourcePath);
    });
    const resources = await Promise.all(actions.map((action) => action.resourcePath
      ? tx.get(database.doc(action.resourcePath)) : Promise.resolve(null)));
    const eventOutboxes = await Promise.all(actions.map((action, index) => {
      if (action.action !== "requeue_event" || !resources[index]?.exists) return Promise.resolve(null);
      const sourceEventId = resources[index]!.get("sourceEventId");
      if (typeof sourceEventId !== "string" || !sourceEventId.startsWith("stage-outbox:")) {
        throw new Error("recovery event is missing its durable stage outbox");
      }
      const outboxId = sourceEventId.slice("stage-outbox:".length);
      if (!/^[A-Za-z0-9_-]{1,256}$/.test(outboxId)) throw new Error("invalid recovery stage outbox id");
      return tx.get(collection(database, COLLECTIONS.outbox).doc(outboxId));
    }));
    const receiptJobs = await Promise.all(actions.map((action) => (
      action.candidateKind === "receipt" && action.resourcePath
        ? tx.get(database.doc(receiptJobPath(action.resourcePath)))
        : Promise.resolve(null)
    )));
    const existingWork = await Promise.all(actions.map((action) => tx.get(work.doc(action.id))));
    const results: Array<RecoveryAction & { emitted: boolean }> = [];
    actions.forEach((action, index) => {
      const resource = resources[index];
      const existing = existingWork[index];
      if (existing.exists) {
        results.push({ ...action, emitted: false });
        return;
      }
      if (resource?.exists) {
        const value = resource.data() as {
          workspaceId?: string; brandId?: string; state?: string; replayPolicy?: string;
          leaseExpiresAt?: string; claimUntil?: string;
        };
        if (action.candidateKind === "receipt") {
          const receiptJob = receiptJobs[index];
          if (!receiptJob?.exists) throw new Error("recovery receipt parent job missing");
          assertTenant(receiptJob.data() as { workspaceId: string; brandId: string });
        } else {
          assertTenant(value as { workspaceId: string; brandId: string });
        }
        const lease = action.candidateKind === "operation" ? value.leaseExpiresAt
          : ["event_inbox", "stage_outbox"].includes(action.candidateKind) ? value.claimUntil : undefined;
        if (lease && Date.parse(lease) > Date.parse(bounds.now)) {
          results.push({ ...action, emitted: false });
          return;
        }
        if (action.action === "replay_operation" && value.state === "claimed" && value.replayPolicy === "safe") {
          tx.update(resource.ref, {
            state: "waiting", updatedAt: bounds.now, ownerId: FieldValue.delete(),
            ownerTokenDigest: FieldValue.delete(), leaseExpiresAt: FieldValue.delete(),
          });
        } else if (["reconcile_operation", "operator_required"].includes(action.action) && action.candidateKind === "operation" && value.state === "claimed") {
          tx.update(resource.ref, {
            state: "unknown", updatedAt: bounds.now, unresolvedReason: action.reason,
            ownerId: FieldValue.delete(), ownerTokenDigest: FieldValue.delete(), leaseExpiresAt: FieldValue.delete(),
          });
        } else if (action.action === "requeue_event" && value.state === "processing") {
          const sourceOutbox = eventOutboxes[index];
          if (!sourceOutbox?.exists) throw new Error("recovery stage outbox is missing");
          const outboxValue = sourceOutbox.data() as StageOutboxRecord;
          assertTenant(outboxValue);
          if (outboxValue.operationId !== action.operationId || outboxValue.sourceEventId !== resource.get("sourceEventId")) {
            throw new Error("recovery stage outbox lineage mismatch");
          }
          tx.update(resource.ref, {
            state: "accepted", updatedAt: bounds.now,
            ownerTokenDigest: FieldValue.delete(), claimUntil: FieldValue.delete(),
          });
          tx.update(sourceOutbox.ref, {
            state: "pending", claimTokenDigest: FieldValue.delete(), claimUntil: FieldValue.delete(),
            pubsubMessageId: FieldValue.delete(), publishedAt: FieldValue.delete(),
          });
        } else if (action.action === "requeue_outbox" && value.state === "claimed") {
          tx.update(resource.ref, {
            state: "pending", claimTokenDigest: FieldValue.delete(), claimUntil: FieldValue.delete(),
          });
        } else if (action.action === "reconcile_effect" && value.state === "dispatched") {
          tx.update(resource.ref, { state: "unknown", unknownReason: action.reason, updatedAt: bounds.now });
        }
      }
      tx.create(work.doc(action.id), recoveryRecord(action, bounds));
      results.push({ ...action, emitted: true });
    });
    return results;
  });
}

export async function runRecovery(input: {
  limit: number; deadlineSeconds: number; maxRetries: number; maxCostUsd: string;
}, database: Firestore = db()) {
  const now = new Date();
  if (!Number.isInteger(input.deadlineSeconds) || input.deadlineSeconds < 1 || input.deadlineSeconds > 60) throw new Error("recovery deadlineSeconds must be between 1 and 60");
  const bounds: RecoveryBounds = {
    now: now.toISOString(), deadline: new Date(now.getTime() + input.deadlineSeconds * 1000).toISOString(),
    maxActions: input.limit, maxRetries: input.maxRetries, maxCostUsd: input.maxCostUsd,
  };
  const candidates = await scanRecoveryCandidates(database, { now: bounds.now, limit: input.limit });
  const plan = planRecovery(candidates, bounds);
  return { ...plan, actions: await applyRecoveryPlan(database, plan.actions, bounds), deadline: bounds.deadline };
}
