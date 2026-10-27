export type OperationKind =
  | "stage"
  | "effect"
  | "verification"
  | "event_wake"
  | "context_projection"
  | "recovery";

export type OperationState =
  | "planned"
  | "runnable"
  | "claimed"
  | "waiting"
  | "unknown"
  | "succeeded"
  | "failed"
  | "cancelled";

export type ReplayPolicy = "safe" | "reconcile" | "never";

export interface OperationGoal {
  type: string;
  version: number;
  digest: string;
  acceptance: string[];
}

export interface OperationBudget {
  tokenLimit?: number;
  toolCallLimit?: number;
  costLimitUsd?: string;
  deadline?: string;
}

export interface OperationRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  jobId: string;
  kind: OperationKind;
  state: OperationState;
  goal: OperationGoal;
  causalParentId?: string;
  correlationId: string;
  replayPolicy: ReplayPolicy;
  epoch: number;
  ownerId?: string;
  ownerTokenDigest?: string;
  leaseExpiresAt?: string;
  attempt: number;
  maxAttempts: number;
  budget: OperationBudget;
  latestProjectionId?: string;
  unresolvedReason?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}

export interface CreateOperationInput {
  id: string;
  workspaceId: string;
  brandId: string;
  jobId: string;
  kind: OperationKind;
  goal: OperationGoal;
  causalParentId?: string;
  correlationId: string;
  replayPolicy: ReplayPolicy;
  maxAttempts: number;
  budget?: OperationBudget;
  now: string;
}

export interface OperationClaimInput {
  ownerId: string;
  ownerTokenDigest: string;
  now: string;
  leaseExpiresAt: string;
}

export type OperationClaimResult = {
  outcome: "execute" | "in_progress" | "unknown" | "succeeded" | "failed" | "cancelled";
  operation: OperationRecord;
};

export interface OperationFence {
  operationId: string;
  workspaceId: string;
  brandId: string;
  epoch: number;
  now: string;
}

export interface FinalizeOperationInput {
  epoch: number;
  state: "waiting" | "unknown" | "succeeded" | "failed" | "cancelled";
  now: string;
  unresolvedReason?: string;
  latestProjectionId?: string;
}

function assertIdentitySegment(value: string): void {
  if (!value || value.includes(":")) throw new Error("invalid operation identity segment");
}

function assertTimestamp(value: string, field: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`invalid ${field}`);
  return parsed;
}

function withoutOwnership(operation: OperationRecord): OperationRecord {
  const next = { ...operation };
  delete next.ownerId;
  delete next.ownerTokenDigest;
  delete next.leaseExpiresAt;
  return next;
}

export function operationIdForStage(jobId: string, stage: string): string {
  assertIdentitySegment(jobId);
  assertIdentitySegment(stage);
  return `job:${jobId}:stage:${stage}`;
}

export function operationIdForStageGeneration(jobId: string, stage: string, generation: number): string {
  if (!Number.isInteger(generation) || generation < 0) throw new Error("invalid stage operation generation");
  return `${operationIdForStage(jobId, stage)}:generation:${generation}`;
}

export function operationIdForEffect(jobId: string, commandId: string): string {
  assertIdentitySegment(jobId);
  assertIdentitySegment(commandId);
  return `job:${jobId}:effect:${commandId}`;
}

export function createOperation(input: CreateOperationInput): OperationRecord {
  assertTimestamp(input.now, "operation timestamp");
  if (!input.id || !input.workspaceId || !input.brandId || !input.jobId || !input.correlationId) {
    throw new Error("operation identity and tenant fields are required");
  }
  if (!Number.isInteger(input.maxAttempts) || input.maxAttempts < 1) {
    throw new Error("operation maxAttempts must be a positive integer");
  }
  if (!Number.isInteger(input.goal.version) || input.goal.version < 1) {
    throw new Error("operation goal version must be a positive integer");
  }
  if (!/^[a-f0-9]{64}$/i.test(input.goal.digest)) {
    throw new Error("operation goal digest must be sha256");
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    jobId: input.jobId,
    kind: input.kind,
    state: "runnable",
    goal: {
      ...input.goal,
      acceptance: [...input.goal.acceptance],
    },
    ...(input.causalParentId ? { causalParentId: input.causalParentId } : {}),
    correlationId: input.correlationId,
    replayPolicy: input.replayPolicy,
    epoch: 0,
    attempt: 0,
    maxAttempts: input.maxAttempts,
    budget: { ...input.budget },
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function claimOperation(
  operation: OperationRecord,
  input: OperationClaimInput,
): OperationClaimResult {
  const now = assertTimestamp(input.now, "claim timestamp");
  const leaseExpiresAt = assertTimestamp(input.leaseExpiresAt, "lease expiry");
  if (leaseExpiresAt <= now) throw new Error("operation lease must expire after claim time");
  if (!input.ownerId || !input.ownerTokenDigest) throw new Error("operation owner is required");

  if (operation.state === "succeeded" || operation.state === "failed" || operation.state === "cancelled") {
    return { outcome: operation.state, operation };
  }
  if (operation.state === "unknown") return { outcome: "unknown", operation };

  if (operation.state === "claimed") {
    if (!operation.leaseExpiresAt) throw new Error("claimed operation has no lease expiry");
    const existingExpiry = assertTimestamp(operation.leaseExpiresAt, "existing lease expiry");
    if (existingExpiry > now) return { outcome: "in_progress", operation };
    if (operation.replayPolicy !== "safe") {
      const unknown = withoutOwnership({
        ...operation,
        state: "unknown",
        unresolvedReason: "operation lease expired under non-replayable policy",
        updatedAt: input.now,
      });
      return { outcome: "unknown", operation: unknown };
    }
  } else if (operation.state !== "runnable" && operation.state !== "waiting") {
    return { outcome: "in_progress", operation };
  }

  if (operation.attempt >= operation.maxAttempts) {
    const failed = withoutOwnership({
      ...operation,
      state: "failed",
      unresolvedReason: "operation attempt budget exhausted",
      updatedAt: input.now,
      completedAt: input.now,
    });
    return { outcome: "failed", operation: failed };
  }

  return {
    outcome: "execute",
    operation: {
      ...operation,
      state: "claimed",
      epoch: operation.epoch + 1,
      attempt: operation.attempt + 1,
      ownerId: input.ownerId,
      ownerTokenDigest: input.ownerTokenDigest,
      leaseExpiresAt: input.leaseExpiresAt,
      updatedAt: input.now,
    },
  };
}

export function assertOperationFence(operation: OperationRecord, fence: OperationFence): void {
  const now = assertTimestamp(fence.now, "fence timestamp");
  if (operation.id !== fence.operationId) throw new Error("operation id mismatch");
  if (operation.workspaceId !== fence.workspaceId || operation.brandId !== fence.brandId) {
    throw new Error("operation tenant mismatch");
  }
  if (operation.epoch !== fence.epoch) throw new Error("operation epoch mismatch");
  if (operation.state !== "claimed") throw new Error(`operation is ${operation.state}`);
  if (!operation.leaseExpiresAt) throw new Error("claimed operation has no lease expiry");
  if (assertTimestamp(operation.leaseExpiresAt, "operation lease expiry") <= now) {
    throw new Error("operation lease expired");
  }
}

export function finalizeOperation(
  operation: OperationRecord,
  input: FinalizeOperationInput,
): OperationRecord {
  assertTimestamp(input.now, "finalization timestamp");
  if (operation.epoch !== input.epoch) throw new Error("operation epoch mismatch");
  if (operation.state !== "claimed") throw new Error(`operation is ${operation.state}`);
  if (input.state === "unknown" && !input.unresolvedReason) {
    throw new Error("unknown operation requires an unresolved reason");
  }

  const next = withoutOwnership({
    ...operation,
    state: input.state,
    updatedAt: input.now,
    ...(input.latestProjectionId ? { latestProjectionId: input.latestProjectionId } : {}),
    ...(input.unresolvedReason ? { unresolvedReason: input.unresolvedReason } : {}),
    ...(["succeeded", "failed", "cancelled"].includes(input.state)
      ? { completedAt: input.now }
      : {}),
  });
  return next;
}
