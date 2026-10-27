export type RecoveryCandidateKind = "operation" | "event_inbox" | "stage_outbox" | "effect" | "receipt" | "artifact";
export type RecoveryActionKind =
  | "replay_operation" | "reconcile_operation" | "operator_required"
  | "requeue_event" | "requeue_outbox" | "reconcile_effect"
  | "finalize_observed_effect" | "enqueue_verification" | "blocked_artifact"
  | "deferred_budget" | "deferred_not_due";

export interface RecoveryCandidate {
  id: string;
  kind: RecoveryCandidateKind;
  workspaceId: string;
  brandId: string;
  jobId: string;
  state: string;
  replayPolicy: "safe" | "reconcile" | "never";
  retryCount: number;
  estimatedCostUsd: string;
  leaseExpiresAt?: string;
  resourcePath?: string;
  operationId?: string;
  artifactId?: string;
  receiptId?: string;
}

export interface RecoveryAction {
  id: string;
  candidateId: string;
  candidateKind: RecoveryCandidateKind;
  action: RecoveryActionKind;
  reason: string;
  resourcePath?: string;
  operationId?: string;
  jobId: string;
  estimatedCostUsd: string;
}

export interface RecoveryBounds {
  now: string;
  deadline: string;
  maxActions: number;
  maxRetries: number;
  maxCostUsd: string;
}

function micros(value: string): bigint {
  if (!/^\d+(?:\.\d{1,6})?$/.test(value)) throw new Error("invalid recovery cost bound");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
}

function usd(value: bigint): string {
  return `${value / BigInt(1_000_000)}.${String(value % BigInt(1_000_000)).padStart(6, "0")}`;
}

function classify(candidate: RecoveryCandidate, nowMs: number): Pick<RecoveryAction, "action" | "reason"> {
  if (candidate.retryCount >= 0 && candidate.retryCount > 1000) throw new Error("invalid recovery retry count");
  if (candidate.kind === "artifact") return { action: "blocked_artifact", reason: `artifact is ${candidate.state}` };
  if (candidate.kind === "receipt") return { action: "enqueue_verification", reason: "receipt has no independent verification" };
  if (candidate.kind === "effect") {
    if (candidate.state === "observed") return { action: "finalize_observed_effect", reason: "provider observation is durable but receipt is absent" };
    return { action: "reconcile_effect", reason: `effect outcome is ${candidate.state}` };
  }
  if (candidate.leaseExpiresAt && Date.parse(candidate.leaseExpiresAt) > nowMs) {
    return { action: "deferred_not_due", reason: "lease remains active" };
  }
  if (candidate.replayPolicy === "never") return { action: "operator_required", reason: "replay policy forbids automatic recovery" };
  if (candidate.kind === "event_inbox") return candidate.replayPolicy === "safe"
    ? { action: "requeue_event", reason: "safe event claim expired" }
    : { action: "operator_required", reason: "event claim requires reconciliation" };
  if (candidate.kind === "stage_outbox") return { action: "requeue_outbox", reason: "outbox publish lease expired before durable acknowledgement" };
  return candidate.replayPolicy === "safe"
    ? { action: "replay_operation", reason: "safe operation lease expired" }
    : { action: "reconcile_operation", reason: "non-replayable operation lease expired" };
}

export function planRecovery(candidates: RecoveryCandidate[], bounds: RecoveryBounds): {
  actions: RecoveryAction[];
  estimatedCostUsd: string;
  scannedCount: number;
} {
  const nowMs = Date.parse(bounds.now);
  const deadlineMs = Date.parse(bounds.deadline);
  if (!Number.isFinite(nowMs) || !Number.isFinite(deadlineMs) || deadlineMs <= nowMs || deadlineMs - nowMs > 60_000) {
    throw new Error("recovery deadline must be within the next 60 seconds");
  }
  if (!Number.isInteger(bounds.maxActions) || bounds.maxActions < 1 || bounds.maxActions > 100) throw new Error("recovery maxActions must be between 1 and 100");
  if (!Number.isInteger(bounds.maxRetries) || bounds.maxRetries < 0 || bounds.maxRetries > 20) throw new Error("recovery maxRetries must be between 0 and 20");
  if (candidates.length > 100) throw new Error("recovery page exceeds 100 candidates");
  const maxCost = micros(bounds.maxCostUsd);
  let used = BigInt(0);
  const actions: RecoveryAction[] = [];
  for (const candidate of [...candidates].sort((a, b) => a.id.localeCompare(b.id)).slice(0, bounds.maxActions)) {
    if (!candidate.id || !candidate.workspaceId || !candidate.brandId || !candidate.jobId) throw new Error("recovery candidate identity is incomplete");
    let decision = candidate.retryCount >= bounds.maxRetries
      ? { action: "operator_required" as const, reason: "retry budget exhausted" }
      : classify(candidate, nowMs);
    const cost = micros(candidate.estimatedCostUsd);
    const chargeable = !["operator_required", "blocked_artifact", "reconcile_effect", "reconcile_operation", "deferred_not_due"].includes(decision.action);
    if (chargeable && used + cost > maxCost) {
      decision = { action: "deferred_budget", reason: "recovery cost budget exhausted" };
    } else if (chargeable) {
      used += cost;
    }
    actions.push({
      // A scan of the same failed attempt must be idempotent, while a later
      // claimed attempt of the same durable resource needs fresh recovery
      // authority. retryCount is the persisted attempt generation for every
      // replayable candidate kind.
      id: `recovery:${candidate.kind}:${candidate.id}:attempt:${candidate.retryCount}:${decision.action}`,
      candidateId: candidate.id, candidateKind: candidate.kind,
      action: decision.action, reason: decision.reason,
      ...(candidate.resourcePath ? { resourcePath: candidate.resourcePath } : {}),
      ...(candidate.operationId ? { operationId: candidate.operationId } : {}),
      jobId: candidate.jobId, estimatedCostUsd: chargeable ? candidate.estimatedCostUsd : "0.000000",
    });
  }
  return { actions, estimatedCostUsd: usd(used), scannedCount: candidates.length };
}
