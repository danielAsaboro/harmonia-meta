import { createHash } from "node:crypto";

import { db } from "./firestore";
import {
  decideEffectClaim, decideEffectFinalization, markEffectClaimDispatched,
  markEffectClaimObserved, markEffectClaimUnknown, restoreEffectClaimForRetry,
} from "./effectClaims";
import {
  effectCommandDigest, markEffectDispatched, markEffectObserved, markEffectProgress,
  markEffectUnknown, markEffectWaitingProvider, restoreEffectPrepared, type EffectCommand,
  type EffectObservedOutcome,
} from "./effectCommands";
import {
  assertOperationFence, claimOperation, createOperation, finalizeOperation,
  operationIdForEffect, type OperationFence, type OperationRecord,
} from "./operations";
import { decideWorkAdmission } from "./operations/workAdmission";
import { actionPayloadDigest } from "./idempotency";
import { canonicalJson } from "./recordReplay/integrity";
import { currentTenant, tenantCollectionPath } from "./tenancy";
import type { ApprovalDecision, EffectClaim, EffectClaimInput, EffectClaimOutcome, Job, PlannedAction, Receipt } from "./types";

const COMMANDS = "effect_commands";
const CLAIMS = "claims";
const JOBS = "jobs";
const RECEIPTS = "receipts";
const CONTENT_ITEMS = "content_items";
const OPERATIONS = "operations";
const APPROVAL_DECISIONS = "approval_decisions";

function commands() {
  return db().collection(tenantCollectionPath(currentTenant(), COMMANDS));
}

function assertStoredCommand(command: EffectCommand): void {
  const digest = effectCommandDigest(command);
  if (digest !== command.payloadDigest) throw new Error("effect command payload changed");
  const authorized = command.authorization.kind === "approval"
    ? command.authorization.approvedPayloadDigest
    : command.authorization.authorizedPayloadDigest;
  if (authorized !== digest) throw new Error("effect command authorization mismatch");
  if (command.observation) {
    const observationDigest = createHash("sha256").update(canonicalJson(command.observation)).digest("hex");
    if (observationDigest !== command.observationDigest) throw new Error("effect command observation changed");
  }
}

function assertCommandTenant(command: EffectCommand): void {
  const tenant = currentTenant();
  if (command.workspaceId !== tenant.workspaceId || command.brandId !== tenant.brandId) {
    throw new Error("effect command tenant mismatch");
  }
}

export function commandClaimInput(
  command: EffectCommand,
  input: Pick<EffectClaimInput, "claimToken" | "operationId" | "traceId">,
): EffectClaimInput {
  assertStoredCommand(command);
  return {
    jobId: command.jobId,
    actionId: command.actionId,
    actionType: command.actionType,
    idempotencyKey: command.payloadDigest,
    ...input,
  };
}

export function assertCommandReceipt(command: EffectCommand, receipt: Receipt): void {
  assertStoredCommand(command);
  if (
    receipt.jobId !== command.jobId
    || receipt.actionId !== command.actionId
    || receipt.actionType !== command.actionType
    || receipt.idempotencyKey !== command.payloadDigest
  ) {
    throw new Error("receipt does not match immutable command");
  }
}

export async function createCommand(command: EffectCommand): Promise<void> {
  assertStoredCommand(command);
  assertCommandTenant(command);
  await commands().doc(command.id).create(command);
}

export async function getCommand(commandId: string): Promise<EffectCommand | null> {
  const snap = await commands().doc(commandId).get();
  if (!snap.exists) return null;
  const command = snap.data() as EffectCommand;
  assertStoredCommand(command);
  assertCommandTenant(command);
  return command;
}

export async function listDueCommands(now = new Date()): Promise<EffectCommand[]> {
  const snaps = await commands().where("state", "in", ["prepared", "waiting_provider", "pending"]).get();
  return snaps.docs
    .map((doc) => doc.data() as EffectCommand)
    .filter((command) => (!command.executeAfter || Date.parse(command.executeAfter) <= now.getTime()) && (!command.nextPollAt || Date.parse(command.nextPollAt) <= now.getTime()))
    .sort((a, b) => Date.parse(a.executeAfter ?? a.createdAt) - Date.parse(b.executeAfter ?? b.createdAt));
}

export async function listCommandsForJob(jobId: string): Promise<EffectCommand[]> {
  const snaps = await commands().where("jobId", "==", jobId).get();
  return snaps.docs.map((doc) => doc.data() as EffectCommand).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export async function listCommandEffectClaimsForJob(jobId: string): Promise<EffectClaim[]> {
  const jobCommands = await listCommandsForJob(jobId);
  const snapshots = await Promise.all(
    jobCommands.map((command) => commands().doc(command.id).collection(CLAIMS).doc("effect").get()),
  );
  return snapshots
    .filter((snapshot) => snapshot.exists)
    .map((snapshot) => snapshot.data() as EffectClaim);
}

export async function claimCommandEffect(
  commandId: string,
  owner: Pick<EffectClaimInput, "claimToken" | "operationId" | "traceId">,
): Promise<EffectClaimOutcome> {
  const commandRef = commands().doc(commandId);
  const claimRef = commandRef.collection(CLAIMS).doc("effect");
  const tenant = currentTenant();
  return db().runTransaction(async (tx) => {
    const commandSnap = await tx.get(commandRef);
    if (!commandSnap.exists) throw new Error("effect command not found");
    const command = commandSnap.data() as EffectCommand;
    const operationId = operationIdForEffect(command.jobId, commandId);
    const operationRef = db().collection(tenantCollectionPath(tenant, OPERATIONS)).doc(operationId);
    const jobRef = db().collection(tenantCollectionPath(tenant, JOBS)).doc(command.jobId);
    const approvalRef = jobRef.collection(APPROVAL_DECISIONS).doc(command.actionId);
    const dependencyRefs = (command.dependsOnCommandIds ?? []).map((id) => commands().doc(id));
    const [claimSnap, operationSnap, jobSnap, approvalSnap] = await Promise.all([
      tx.get(claimRef), tx.get(operationRef), tx.get(jobRef), tx.get(approvalRef),
    ]);
    const dependencySnaps = await Promise.all(dependencyRefs.map((ref) => tx.get(ref)));
    assertStoredCommand(command);
    assertCommandTenant(command);
    dependencySnaps.forEach((snapshot, index) => {
      if (!snapshot.exists) throw new Error(`effect command dependency ${command.dependsOnCommandIds![index]} is missing`);
      const dependency = snapshot.data() as EffectCommand;
      assertStoredCommand(dependency);
      assertCommandTenant(dependency);
      if (dependency.jobId !== command.jobId || dependency.state !== "applied") {
        throw new Error(`effect command dependency ${dependency.id} is not applied`);
      }
    });
    if (["cancelled", "failed", "unknown"].includes(command.state)) throw new Error(`effect command is ${command.state}`);
    if (command.executeAfter && Date.parse(command.executeAfter) > Date.now()) throw new Error("effect command is not due");
    const input = commandClaimInput(command, owner);
    let existingClaim = claimSnap.exists ? claimSnap.data() as EffectClaim : null;
    let safeExpiredBeforeDispatch = false;
    if (
      existingClaim
      && existingClaim.state === "claimed"
      && Date.parse(existingClaim.leaseExpiresAt) <= Date.now()
      && (command.state === "prepared" || (command.state as string) === "pending")
    ) {
      safeExpiredBeforeDispatch = true;
      existingClaim = { ...existingClaim, state: "failed", finalizedAt: new Date().toISOString() };
    }
    let result = decideEffectClaim(existingClaim, input);
    if (result.outcome !== "already_applied" && owner.operationId !== operationId) {
      throw new Error("effect command operation id mismatch");
    }
    if (result.outcome === "execute") {
      if (!jobSnap.exists) throw new Error("effect command job not found");
      const job = jobSnap.data() as Job & { actions: PlannedAction[] };
      if (job.workspaceId !== tenant.workspaceId || job.brandId !== tenant.brandId) throw new Error("effect command job tenant mismatch");
      const admission = decideWorkAdmission(job.controlState);
      if (admission.outcome !== "execute") return admission;
      if (command.sourceKind === "job_action") {
        const action = job.actions?.find((candidate) => candidate.id === command.actionId);
        if (!action || action.state !== "planned" || action.type !== command.actionType || canonicalJson(action.payload) !== canonicalJson(command.payload)) {
          throw new Error("effect command action is no longer current");
        }
        if (command.authorization.kind === "approval" && action.approvalState !== "approved") {
          throw new Error("effect command approval has been revoked");
        }
        if (command.authorization.kind === "approval") {
          if (!approvalSnap.exists) throw new Error("effect command approval decision is missing");
          const approval = approvalSnap.data() as ApprovalDecision;
          if (
            approval.id !== command.authorization.approvalId
            || approval.jobId !== command.jobId
            || approval.actionId !== command.actionId
            || approval.decision !== "approved"
            || approval.payloadDigest !== actionPayloadDigest(action)
            || !["firebase_operator", "telegram_operator"].includes(approval.actorType)
            || !approval.actorSubjectId
            || !approval.authenticationId
            || approval.channel !== (approval.actorType === "firebase_operator" ? "dashboard" : "telegram")
            || approval.operationId !== `${command.jobId}:approval:${command.actionId}`
            || !/^[a-f0-9]{32}$/.test(approval.traceId)
            || approval.traceId === "0".repeat(32)
            || !Number.isFinite(Date.parse(approval.decidedAt))
          ) throw new Error("effect command approval decision is stale");
        }
        if (command.authorization.kind === "mandate" && action.approvalState !== "not_required") {
          throw new Error("effect command mandate is no longer valid");
        }
      }
      const now = result.claim.claimedAt;
      let operation = operationSnap.exists
        ? operationSnap.data() as OperationRecord
        : createOperation({
            id: operationId, workspaceId: command.workspaceId, brandId: command.brandId,
            jobId: command.jobId, kind: "effect",
            goal: { type: command.actionType, version: 1, digest: command.payloadDigest, acceptance: ["persist provider observation", "persist receipt"] },
            correlationId: `job:${command.jobId}`, replayPolicy: "reconcile", maxAttempts: 10, now,
          });
      if (safeExpiredBeforeDispatch && operation.state === "claimed") {
        operation = finalizeOperation(operation, {
          epoch: operation.epoch, state: "waiting", now,
        });
      }
      const operationClaim = claimOperation(operation, {
        ownerId: "harmonia-effect-executor",
        ownerTokenDigest: createHash("sha256").update(owner.claimToken).digest("hex"),
        now,
        leaseExpiresAt: result.claim.leaseExpiresAt,
      });
      if (operationClaim.outcome !== "execute") {
        if (operationClaim.outcome === "unknown") return { outcome: "uncertain", claim: result.claim };
        throw new Error(`effect operation is ${operationClaim.outcome}`);
      }
      result = {
        ...result,
        claim: {
          ...result.claim,
          operationEpoch: operationClaim.operation.epoch,
          goalDigest: operationClaim.operation.goal.digest,
        },
      };
      tx.set(claimRef, result.claim);
      if (operationSnap.exists) tx.set(operationRef, operationClaim.operation);
      else tx.create(operationRef, operationClaim.operation);
    }
    return result;
  });
}

export type EffectDispatchTransition =
  | { phase: "dispatched"; claimToken: string; attempt: number }
  | { phase: "progress"; claimToken: string; progress: { kind: "x_thread"; confirmedPostIds: string[] } }
  | { phase: "provider_not_started"; claimToken: string }
  | { phase: "provider_pending"; claimToken: string; providerOperationId: string; nextPollAt: string }
  | { phase: "observed"; claimToken: string; outcome: EffectObservedOutcome; artifact?: unknown; detail: Record<string, unknown> }
  | { phase: "unknown"; claimToken: string; reason: string };

export async function transitionCommandEffect(
  commandId: string,
  input: EffectDispatchTransition,
  fence: OperationFence,
): Promise<EffectCommand> {
  const tenant = currentTenant();
  const commandRef = commands().doc(commandId);
  const claimRef = commandRef.collection(CLAIMS).doc("effect");
  const operationRef = db().collection(tenantCollectionPath(tenant, OPERATIONS)).doc(fence.operationId);
  return db().runTransaction(async (tx) => {
    const [commandSnap, claimSnap, operationSnap] = await Promise.all([
      tx.get(commandRef), tx.get(claimRef), tx.get(operationRef),
    ]);
    if (!commandSnap.exists || !claimSnap.exists || !operationSnap.exists) {
      throw new Error("effect command aggregate not found");
    }
    const command = commandSnap.data() as EffectCommand;
    const claim = claimSnap.data() as EffectClaim;
    const operation = operationSnap.data() as OperationRecord;
    assertStoredCommand(command);
    assertCommandTenant(command);
    assertOperationFence(operation, fence);
    if (claim.operationEpoch !== fence.epoch || claim.operationId !== fence.operationId) {
      throw new Error("effect claim operation fence mismatch");
    }
    let nextCommand: EffectCommand;
    let nextClaim: EffectClaim;
    if (input.phase === "dispatched") {
      nextCommand = markEffectDispatched(command, {
        operationId: fence.operationId, operationEpoch: fence.epoch,
        attempt: input.attempt, now: fence.now,
      });
      nextClaim = markEffectClaimDispatched(claim, {
        claimToken: input.claimToken, operationEpoch: fence.epoch,
        goalDigest: operation.goal.digest, now: fence.now,
      });
    } else if (input.phase === "progress") {
      nextCommand = markEffectProgress(command, {
        operationId: fence.operationId, operationEpoch: fence.epoch,
        progress: input.progress, now: fence.now,
      });
      nextClaim = claim;
    } else if (input.phase === "observed") {
      nextCommand = markEffectObserved(command, {
        operationId: fence.operationId, operationEpoch: fence.epoch,
        outcome: input.outcome, artifact: input.artifact,
        detail: input.detail, now: fence.now,
      });
      nextClaim = markEffectClaimObserved(claim, input.claimToken, fence.now);
    } else if (input.phase === "provider_pending") {
      nextCommand = markEffectWaitingProvider(command, {
        operationId: fence.operationId, operationEpoch: fence.epoch,
        providerOperationId: input.providerOperationId, nextPollAt: input.nextPollAt, now: fence.now,
      });
      nextClaim = restoreEffectClaimForRetry(claim, input.claimToken, fence.now);
      tx.set(operationRef, finalizeOperation(operation, {
        epoch: fence.epoch, state: "waiting", now: fence.now,
      }));
    } else if (input.phase === "unknown") {
      nextCommand = markEffectUnknown(command, {
        operationId: fence.operationId, operationEpoch: fence.epoch,
        reason: input.reason, now: fence.now,
      });
      nextClaim = markEffectClaimUnknown(claim, input.claimToken, input.reason);
      tx.set(operationRef, finalizeOperation(operation, {
        epoch: fence.epoch, state: "unknown", unresolvedReason: input.reason, now: fence.now,
      }));
    } else {
      nextCommand = restoreEffectPrepared(command, {
        operationId: fence.operationId, operationEpoch: fence.epoch,
        proof: "provider_not_started", now: fence.now,
      });
      nextClaim = restoreEffectClaimForRetry(claim, input.claimToken, fence.now);
      tx.set(operationRef, finalizeOperation(operation, {
        epoch: fence.epoch, state: "waiting", now: fence.now,
      }));
    }
    tx.set(commandRef, nextCommand);
    tx.set(claimRef, nextClaim);
    return nextCommand;
  });
}

export async function finalizeCommandReceipt(
  commandId: string,
  receipt: Receipt,
  claimToken: string,
  fence: OperationFence,
): Promise<{ duplicate: boolean; receipt: Receipt }> {
  const tenant = currentTenant();
  const commandRef = commands().doc(commandId);
  const claimRef = commandRef.collection(CLAIMS).doc("effect");
  const jobRef = db().collection(tenantCollectionPath(tenant, JOBS)).doc(receipt.jobId);
  const receiptRef = jobRef.collection(RECEIPTS).doc(receipt.id);
  const operationRef = db().collection(tenantCollectionPath(tenant, OPERATIONS)).doc(fence.operationId);
  return db().runTransaction(async (tx) => {
    const [commandSnap, claimSnap, jobSnap, operationSnap] = await Promise.all([
      tx.get(commandRef), tx.get(claimRef), tx.get(jobRef), tx.get(operationRef),
    ]);
    if (!commandSnap.exists || !claimSnap.exists || !operationSnap.exists) throw new Error("effect command claim not found");
    const command = commandSnap.data() as EffectCommand;
    assertCommandReceipt(command, receipt);
    assertCommandTenant(command);
    const claim = claimSnap.data() as EffectClaim;
    const operation = operationSnap.data() as OperationRecord;
    assertOperationFence(operation, fence);
    if (command.state !== "observed" || !command.observation) throw new Error("effect command has no durable provider observation");
    if (
      command.observation.outcome !== receipt.outcome
      || canonicalJson(command.observation.artifact ?? null) !== canonicalJson(receipt.artifact ?? null)
      || canonicalJson(command.observation.detail) !== canonicalJson(receipt.detail)
    ) throw new Error("receipt differs from durable provider observation");
    const finalized = decideEffectFinalization(claim, claimToken, receipt.id, receipt.outcome);
    if (finalized.duplicate) {
      const original = await tx.get(jobRef.collection(RECEIPTS).doc(finalized.receiptId));
      if (!original.exists) throw new Error("finalized command receipt is missing");
      return { duplicate: true, receipt: original.data() as Receipt };
    }
    const commandState = receipt.outcome === "applied" || receipt.outcome === "already_applied" ? "applied" : "failed";
    if (command.sourceKind === "job_action") {
      if (!jobSnap.exists) throw new Error("effect command job not found");
      const job = jobSnap.data() as Job & { actions?: PlannedAction[] };
      const actions = [...(job.actions ?? [])];
      const index = actions.findIndex((action) => action.id === command.actionId);
      if (index < 0) throw new Error("effect command action not found");
      actions[index] = { ...actions[index], state: commandState === "applied" ? "executed" : "failed" };
      tx.update(jobRef, { actions, updatedAt: receipt.performedAt });
    } else {
      const itemRef = db().collection(tenantCollectionPath(tenant, CONTENT_ITEMS)).doc(command.sourceId);
      const itemSnap = await tx.get(itemRef);
      if (!itemSnap.exists) throw new Error("scheduled content source not found");
      tx.update(itemRef, commandState === "applied"
        ? { status: "published", publishedAt: receipt.performedAt, updatedAt: receipt.performedAt }
        : { status: "failed", failureReason: String(receipt.detail.error ?? receipt.outcome), updatedAt: receipt.performedAt });
    }
    tx.create(receiptRef, receipt);
    tx.set(claimRef, finalized.claim);
    tx.update(commandRef, { state: commandState, updatedAt: receipt.performedAt });
    tx.set(operationRef, finalizeOperation(operation, {
      epoch: fence.epoch,
      state: commandState === "applied" ? "succeeded" : "failed",
      now: receipt.performedAt,
    }));
    return { duplicate: false, receipt };
  });
}
