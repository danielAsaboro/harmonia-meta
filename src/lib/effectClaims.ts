import type { EffectClaim, EffectClaimInput, EffectClaimOutcome, EffectClaimSummary } from "./types";

type EffectClaimDecision = Exclude<EffectClaimOutcome, { outcome: "paused" | "cancelled" }>;

const CLAIM_LEASE_MS = 5 * 60 * 1000;

function nextClaim(input: EffectClaimInput, attempt: number, now: Date): EffectClaim {
  return {
    id: input.idempotencyKey,
    ...input,
    state: "claimed",
    attempt,
    claimedAt: now.toISOString(),
    leaseExpiresAt: new Date(now.getTime() + CLAIM_LEASE_MS).toISOString(),
  };
}

function assertSameIdentity(existing: EffectClaim, input: EffectClaimInput): void {
  if (
    existing.jobId !== input.jobId
    || existing.actionId !== input.actionId
    || existing.actionType !== input.actionType
    || existing.idempotencyKey !== input.idempotencyKey
  ) {
    throw new Error("effect claim identity mismatch");
  }
}

export function decideEffectClaim(
  existing: EffectClaim | null,
  input: EffectClaimInput,
  now = new Date(),
): EffectClaimDecision {
  if (!existing) return { outcome: "execute", claim: nextClaim(input, 1, now) };
  assertSameIdentity(existing, input);
  if (existing.state === "applied") {
    if (!existing.receiptId) throw new Error("applied effect claim is missing its receipt");
    return { outcome: "already_applied", claim: existing, receiptId: existing.receiptId };
  }
  if (existing.state === "failed") {
    return { outcome: "execute", claim: nextClaim(input, existing.attempt + 1, now) };
  }
  if (existing.state === "unknown") return { outcome: "uncertain", claim: existing };
  if (existing.state === "claimed" && Date.parse(existing.leaseExpiresAt) <= now.getTime()) {
    return { outcome: "execute", claim: nextClaim(input, existing.attempt + 1, now) };
  }
  if (Date.parse(existing.leaseExpiresAt) <= now.getTime()) {
    return { outcome: "uncertain", claim: existing };
  }
  return { outcome: "in_progress", claim: existing };
}

export type EffectFinalization =
  | { duplicate: true; claim: EffectClaim; receiptId: string }
  | { duplicate: false; claim: EffectClaim; receiptId: string };

export function redactEffectClaim(claim: EffectClaim): EffectClaimSummary {
  return {
    id: claim.id, actionId: claim.actionId, idempotencyKey: claim.idempotencyKey,
    state: claim.state, attempt: claim.attempt, claimedAt: claim.claimedAt,
    finalizedAt: claim.finalizedAt, receiptId: claim.receiptId,
    operationId: claim.operationId, traceId: claim.traceId,
  };
}

export function effectClaimResponse(result: EffectClaimOutcome, input: EffectClaimInput) {
  if (!("claim" in result)) {
    return {
      outcome: result.outcome,
      idempotencyKey: input.idempotencyKey,
      operationId: input.operationId,
      traceId: input.traceId,
    };
  }
  return {
    outcome: result.outcome,
    attempt: result.claim.attempt,
    idempotencyKey: input.idempotencyKey,
    operationId: input.operationId,
    traceId: input.traceId,
    ...(result.claim.operationEpoch ? { operationEpoch: result.claim.operationEpoch } : {}),
    ...(result.claim.goalDigest ? { goalDigest: result.claim.goalDigest } : {}),
    ...(result.outcome === "already_applied" ? { receiptId: result.receiptId } : {}),
  };
}

function assertClaimOwner(claim: EffectClaim, claimToken: string): void {
  if (claim.claimToken !== claimToken) throw new Error("effect claim owner mismatch");
}

export function markEffectClaimDispatched(
  claim: EffectClaim,
  input: { claimToken: string; operationEpoch: number; goalDigest: string; now: string },
): EffectClaim {
  assertClaimOwner(claim, input.claimToken);
  if (claim.state !== "claimed") throw new Error(`effect claim cannot dispatch from state '${claim.state}'`);
  return { ...claim, state: "dispatched", operationEpoch: input.operationEpoch, goalDigest: input.goalDigest, dispatchedAt: input.now };
}

export function markEffectClaimObserved(claim: EffectClaim, claimToken: string, now: string): EffectClaim {
  assertClaimOwner(claim, claimToken);
  if (claim.state !== "dispatched") throw new Error(`effect claim cannot observe from state '${claim.state}'`);
  return { ...claim, state: "observed", observedAt: now };
}

export function markEffectClaimUnknown(claim: EffectClaim, claimToken: string, reason: string): EffectClaim {
  assertClaimOwner(claim, claimToken);
  if (claim.state !== "dispatched") throw new Error(`effect claim cannot become unknown from state '${claim.state}'`);
  return { ...claim, state: "unknown", unknownReason: reason };
}

export function restoreEffectClaimForRetry(claim: EffectClaim, claimToken: string, now: string): EffectClaim {
  assertClaimOwner(claim, claimToken);
  if (claim.state !== "dispatched") throw new Error(`effect claim cannot restore from state '${claim.state}'`);
  return { ...claim, state: "failed", finalizedAt: now };
}

export function decideEffectFinalization(
  claim: EffectClaim,
  claimToken: string,
  receiptId: string,
  outcome: "applied" | "already_applied" | "rejected" | "failed",
  now = new Date(),
): EffectFinalization {
  if (claim.state === "applied") {
    if (!claim.receiptId) throw new Error("applied effect claim is missing its receipt");
    return { duplicate: true, claim, receiptId: claim.receiptId };
  }
  if (claim.state !== "claimed" && claim.state !== "observed") throw new Error(`effect claim cannot finalize from state '${claim.state}'`);
  if (claim.claimToken !== claimToken) throw new Error("effect claim owner mismatch");
  const finalized: EffectClaim = {
    ...claim,
    state: outcome === "applied" || outcome === "already_applied" ? "applied" : "failed",
    receiptId,
    finalizedAt: now.toISOString(),
  };
  return { duplicate: false, claim: finalized, receiptId };
}
