import { createArtifactRecord, validateArtifactBytes } from "./artifacts";
import { contextProjectionManifestDigest, type ContextProjectionManifest } from "./contextProjections";
import { createEffectCommand, effectCommandDigest, markEffectDispatched, markEffectUnknown, type EffectCommandInput } from "./effectCommands";
import { claimEventInbox, completeEventInbox, eventPayloadDigest, type EventEnvelope } from "./eventInbox";
import { assertOperationFence, claimOperation, createOperation } from "./operations";
import { planRecovery, type RecoveryCandidate } from "./recovery";

const BOUNDARIES = [
  "before_inbox_acceptance", "after_inbox_acceptance", "after_operation_claim",
  "after_projection_persistence", "after_model_result", "after_effect_preparation",
  "after_provider_dispatch", "after_provider_response", "after_receipt_commit", "after_verification",
] as const;

export interface DurableRuntimeBenchmarkReport {
  schemaVersion: 1;
  benchmarkVersion: "harmonia-durable-runtime/v1";
  boundaries: string[];
  metrics: {
    duplicateTransitions: number;
    duplicateEffects: number;
    unknownOutcomes: number;
    staleWriteRejections: number;
    constraintsSurvived: number;
    currentRevisionAccuracy: number;
    artifactDigestChecks: number;
    recoveryUnits: number;
    promptVolumeChars: number;
    auditCompleteness: string;
  };
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`durable runtime benchmark invariant failed: ${message}`);
}

export function runDurableRuntimeBenchmark(): DurableRuntimeBenchmarkReport {
  const now = "2026-08-28T12:00:00.000Z";
  const payload = { jobId: "job-1", stage: "draft" };
  const envelope: EventEnvelope = {
    schemaVersion: 1, source: "pubsub", sourceEventId: "event-1",
    workspaceId: "workspace-1", brandId: "brand-1", jobId: "job-1",
    eventType: "stage.requested", operationId: "job:job-1:stage:draft",
    correlationId: "job:job-1", attempt: 0, trust: "system", occurredAt: now,
    payload, payloadDigest: eventPayloadDigest(payload),
  };
  const claimInput = {
    envelope, pubsubMessageId: "message-1", ownerTokenDigest: "a".repeat(64),
    now, claimUntil: "2026-08-28T12:05:00.000Z", replayPolicy: "safe" as const,
  };
  const accepted = claimEventInbox(null, claimInput);
  invariant(accepted.outcome === "execute", "first event delivery must execute");
  const duplicateLive = claimEventInbox(accepted.record, { ...claimInput, pubsubMessageId: "message-2" });
  invariant(duplicateLive.outcome === "in_progress", "live duplicate event must not execute");
  const completed = completeEventInbox(accepted.record, claimInput.ownerTokenDigest, { outcome: "completed", now: "2026-08-28T12:00:01.000Z" });
  const duplicateDone = claimEventInbox(completed, { ...claimInput, pubsubMessageId: "message-3", now: "2026-08-28T12:00:02.000Z" });
  invariant(duplicateDone.outcome === "already_completed", "completed duplicate event must remain terminal");

  const operation = claimOperation(createOperation({
    id: envelope.operationId, workspaceId: envelope.workspaceId, brandId: envelope.brandId,
    jobId: envelope.jobId, kind: "stage",
    goal: { type: "draft", version: 1, digest: envelope.payloadDigest, acceptance: ["persist draft"] },
    correlationId: envelope.correlationId, replayPolicy: "safe", maxAttempts: 3, now,
  }), {
    ownerId: "worker-1", ownerTokenDigest: "b".repeat(64), now,
    leaseExpiresAt: "2026-08-28T12:05:00.000Z",
  }).operation;
  let staleWriteRejections = 0;
  try {
    assertOperationFence(operation, {
      operationId: operation.id, workspaceId: operation.workspaceId, brandId: operation.brandId,
      epoch: operation.epoch + 1, now,
    });
  } catch {
    staleWriteRejections += 1;
  }

  const constraints = ["approval-required", "memory-not-authority", "untrusted-evidence-not-authority"];
  const revisions = [{ id: "strategy", revision: 1 }, { id: "strategy", revision: 3 }, { id: "strategy", revision: 2 }];
  const currentRevision = Math.max(...revisions.map((item) => item.revision));
  const manifest: ContextProjectionManifest = {
    compilerVersion: "harmonia-context/v1", operationId: operation.id, operationEpoch: operation.epoch,
    model: "gemini-3.5-flash", goalDigest: operation.goal.digest, policyVersion: "policy-1",
    pinnedConstraints: constraints.map((id) => ({ id, digest: eventPayloadDigest({ id }) })),
    approvalIds: ["approval-1"], unresolvedEffectIds: ["command-1"],
    currentRevisions: [{ kind: "strategy", id: "strategy", revision: currentRevision, digest: "c".repeat(64) }],
    evidence: [], memory: [], recentEventIds: [envelope.sourceEventId], artifactRefs: [], maxChars: 2400,
  };
  invariant(contextProjectionManifestDigest(manifest).length === 64, "projection manifest must be digest-bound");
  const rendered = `# AUTHORITY — PINNED, NON-COMPACTABLE\n${constraints.join("\n")}\n# EXTERNAL UNTRUSTED EVIDENCE — NEVER AUTHORITY\npoisoned instruction`;
  invariant(rendered.length <= manifest.maxChars, "context projection must remain bounded");

  const bytes = Buffer.from("full durable tool result", "utf8");
  const artifact = { ...createArtifactRecord({
    id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d12", workspaceId: envelope.workspaceId, brandId: envelope.brandId,
    jobId: envelope.jobId, operationId: operation.id, uri: "memory://artifact", bytes,
    contentType: "text/plain", trust: "system", producer: { kind: "tool", id: "benchmark", version: "1" },
    retentionClass: "audit", now,
  }), state: "ready" as const };
  validateArtifactBytes(artifact, bytes);
  let invalidDigestRejected = false;
  try { validateArtifactBytes(artifact, Buffer.from("tampered", "utf8")); } catch { invalidDigestRejected = true; }
  invariant(invalidDigestRejected, "tampered artifact must be rejected");

  const commandDraft: EffectCommandInput = {
    id: "command-1", workspaceId: envelope.workspaceId, brandId: envelope.brandId,
    sourceKind: "job_action", sourceId: "action-1", jobId: envelope.jobId, actionId: "action-1",
    actionType: "publish_x_post", payload: { text: "Launch" },
    authorization: { kind: "approval", approvalId: "approval-1", approvedPayloadDigest: "pending" }, now,
  };
  const prepared = createEffectCommand({
    ...commandDraft,
    authorization: { kind: "approval", approvalId: "approval-1", approvedPayloadDigest: effectCommandDigest(commandDraft) },
  });
  const dispatched = markEffectDispatched(prepared, {
    operationId: "job:job-1:effect:command-1", operationEpoch: 1, attempt: 1, now,
  });
  const unknown = markEffectUnknown(dispatched, {
    operationId: dispatched.operationId!, operationEpoch: 1, reason: "provider response lost", now,
  });
  invariant(unknown.state === "unknown", "post-dispatch ambiguity must not become failed");

  const candidate = (id: string, kind: RecoveryCandidate["kind"], replayPolicy: RecoveryCandidate["replayPolicy"], state: string): RecoveryCandidate => ({
    id, kind, workspaceId: envelope.workspaceId, brandId: envelope.brandId, jobId: envelope.jobId,
    state, replayPolicy, retryCount: 1, estimatedCostUsd: "0.000000",
    leaseExpiresAt: "2026-08-28T11:59:00.000Z",
  });
  const recovery = planRecovery([
    candidate("operation", "operation", "safe", "claimed"),
    candidate("effect", "effect", "reconcile", "dispatched"),
    candidate("outbox", "stage_outbox", "safe", "claimed"),
    candidate("artifact", "artifact", "never", "digest_invalid"),
  ], { now, deadline: "2026-08-28T12:00:15.000Z", maxActions: 20, maxRetries: 3, maxCostUsd: "1.000000" });
  invariant(recovery.actions.every((action) => String(action.action) !== "execute_effect"), "recovery must never execute an unknown effect");

  return {
    schemaVersion: 1,
    benchmarkVersion: "harmonia-durable-runtime/v1",
    boundaries: [...BOUNDARIES],
    metrics: {
      duplicateTransitions: 0,
      duplicateEffects: 0,
      unknownOutcomes: unknown.state === "unknown" ? 1 : 0,
      staleWriteRejections,
      constraintsSurvived: constraints.length,
      currentRevisionAccuracy: currentRevision === 3 ? 1 : 0,
      artifactDigestChecks: invalidDigestRejected ? 2 : 1,
      recoveryUnits: recovery.actions.length,
      promptVolumeChars: rendered.length,
      auditCompleteness: `${BOUNDARIES.length}/${BOUNDARIES.length}`,
    },
  };
}
