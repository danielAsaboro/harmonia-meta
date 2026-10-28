export type StageExecutionState = "claimed" | "applied" | "failed" | "uncertain";

export interface StageExecution {
  jobId: string;
  stage: string;
  operationId: string;
  state: StageExecutionState;
  ownerId: string;
  claimTokenDigest: string;
  claimedAt: string;
  leaseExpiresAt: string;
  updatedAt: string;
  finalizedAt?: string;
  failureReason?: string;
}

export interface StageClaimInput {
  ownerId: string;
  claimTokenDigest: string;
  now: string;
  leaseExpiresAt: string;
}

export type ActiveStageClaimResult = {
  outcome: "execute" | "in_progress" | "already_applied" | "failed" | "uncertain";
  execution: StageExecution;
};

export type StageClaimResult =
  | ActiveStageClaimResult
  | { outcome: "paused" | "cancelled" };

export function claimStageExecution(
  existing: StageExecution | null,
  input: StageClaimInput & { jobId?: string; stage?: string; operationId?: string },
): ActiveStageClaimResult {
  if (!existing) {
    if (!input.jobId || !input.stage || !input.operationId) throw new Error("new stage claim requires job, stage, and operation");
    const execution: StageExecution = {
      jobId: input.jobId,
      stage: input.stage,
      operationId: input.operationId,
      state: "claimed",
      ownerId: input.ownerId,
      claimTokenDigest: input.claimTokenDigest,
      claimedAt: input.now,
      leaseExpiresAt: input.leaseExpiresAt,
      updatedAt: input.now,
    };
    return { outcome: "execute", execution };
  }
  if (existing.state === "applied") return { outcome: "already_applied", execution: existing };
  if (existing.state === "failed") return { outcome: "failed", execution: existing };
  if (existing.state === "uncertain") return { outcome: "uncertain", execution: existing };
  if (Date.parse(existing.leaseExpiresAt) <= Date.parse(input.now)) {
    return {
      outcome: "uncertain",
      execution: {
        ...existing,
        state: "uncertain",
        failureReason: "stage lease expired before finalization",
        updatedAt: input.now,
        finalizedAt: input.now,
      },
    };
  }
  return { outcome: "in_progress", execution: existing };
}

export function finalizeStageExecution(
  execution: StageExecution,
  claimTokenDigest: string,
  outcome: "applied" | "failed" | "uncertain",
  finalizedAt: string,
  failureReason?: string,
): StageExecution {
  if (execution.state !== "claimed") throw new Error(`stage execution is ${execution.state}`);
  if (execution.claimTokenDigest !== claimTokenDigest) throw new Error("stage claim token mismatch");
  return {
    ...execution,
    state: outcome,
    updatedAt: finalizedAt,
    finalizedAt,
    ...(failureReason ? { failureReason } : {}),
  };
}
