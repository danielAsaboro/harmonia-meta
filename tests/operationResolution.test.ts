import { describe, expect, it } from "vitest";

import { firebasePrincipal, servicePrincipal } from "@/lib/authority";
import { resolveOperationAggregate } from "@/lib/operationResolution";
import { runWithTenant } from "@/lib/tenancy";
import type { ArtifactRecord } from "@/lib/artifacts";
import type { EffectCommand } from "@/lib/effectCommands";
import type { EffectClaim, Job, PlannedAction } from "@/lib/types";
import type { OperationRecord } from "@/lib/operations";

const now = "2026-08-28T12:00:00.000Z";
const operation: OperationRecord = {
  id: "job:job-1:effect:command-1", workspaceId: "workspace-1", brandId: "brand-1", jobId: "job-1",
  kind: "effect", state: "unknown", goal: { type: "publish_x_post", version: 1, digest: "a".repeat(64), acceptance: ["receipt"] },
  correlationId: "job:job-1", replayPolicy: "reconcile", epoch: 2, attempt: 1, maxAttempts: 3,
  budget: {}, unresolvedReason: "provider response lost", createdAt: now, updatedAt: now,
};
const command: EffectCommand = {
  id: "command-1", workspaceId: "workspace-1", brandId: "brand-1", sourceKind: "job_action", sourceId: "action-1",
  jobId: "job-1", actionId: "action-1", actionType: "publish_x_post", payload: { text: "Launch" },
  payloadDigest: "a".repeat(64), authorization: { kind: "approval", approvalId: "approval-1", approvedPayloadDigest: "a".repeat(64) },
  state: "unknown", operationId: operation.id, operationEpoch: 2, dispatchAttempt: 1, dispatchedAt: now,
  unknownReason: "provider response lost", createdAt: now, updatedAt: now,
};
const claim: EffectClaim = {
  id: command.payloadDigest, jobId: "job-1", actionId: "action-1", actionType: "publish_x_post",
  idempotencyKey: command.payloadDigest, operationId: operation.id, traceId: "b".repeat(32), claimToken: "owner-1",
  state: "unknown", attempt: 1, claimedAt: now, leaseExpiresAt: now, operationEpoch: 2,
};
const job = {
  id: "job-1", workspaceId: "workspace-1", brandId: "brand-1", createdByUserId: "operator-1",
  createdAt: now, updatedAt: now, status: "running", controlEpoch: 0, controlState: "running", stage: "publish", config: { sourceManifestId: "manifest-1", desiredOutputs: ["x_post"], allowedOutputs: ["x_post"], platforms: ["x"] },
  actions: [{
    id: "action-1", jobId: "job-1", type: "publish_x_post", title: "Post", description: "",
    risk: "high", requiresApproval: true, approvalState: "approved", payload: { text: "Launch" }, state: "planned",
  }],
} as Job & { actions: PlannedAction[] };
const artifact: ArtifactRecord = {
  id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d99", workspaceId: "workspace-1", brandId: "brand-1",
  jobId: "job-1", operationId: operation.id, uri: "gs://evidence/operator.png", sha256: "c".repeat(64),
  contentType: "image/png", byteCount: 100, preview: "[binary image/png; 100 bytes]", trust: "operator",
  producer: { kind: "operator", id: "dashboard", version: "1" }, retentionClass: "audit", state: "ready",
  createdAt: now, updatedAt: now,
};
const operatorScope = {
  workspaceId: "workspace-1", brandId: "brand-1",
  principal: firebasePrincipal({ subjectId: "operator-1", workspaceRole: "owner", authenticationId: "session-1" }),
};

function resolve(choice: "confirm_applied" | "confirm_not_applied" | "compensate" | "cancel") {
  return runWithTenant(operatorScope, () => resolveOperationAggregate({
    operation, command, claim, job, evidence: [artifact], choice,
    reason: "Operator reconciled the provider account and attached evidence.", expectedEpoch: 2, now,
  }));
}

describe("operator resolution of unknown effects", () => {
  it("supports four explicit decisions with distinct durable outcomes", () => {
    expect(resolve("confirm_applied")).toMatchObject({
      operation: { state: "succeeded" }, command: { state: "applied" },
      claim: { state: "applied", receiptId: expect.any(String) },
      job: { actions: [{ state: "executed" }] }, receipt: { outcome: "applied" },
    });
    expect(resolve("confirm_not_applied")).toMatchObject({
      operation: { state: "waiting" }, command: { state: "prepared" }, claim: { state: "failed" },
    });
    expect(resolve("compensate")).toMatchObject({
      operation: { state: "cancelled" }, command: { state: "cancelled" },
      operatorTask: { kind: "compensate_effect", state: "pending" },
    });
    const cancelled = resolve("cancel");
    expect(cancelled).toMatchObject({
      operation: { state: "cancelled" }, command: { state: "cancelled" },
    });
    expect(cancelled).not.toHaveProperty("operatorTask");
  });

  it("requires an operator, exact current epoch, reason, and ready digest-bound audit evidence", () => {
    expect(() => runWithTenant({ ...operatorScope, principal: servicePrincipal("worker") }, () => resolveOperationAggregate({
      operation, command, claim, job, evidence: [artifact], choice: "cancel", reason: "A sufficiently detailed reason.", expectedEpoch: 2, now,
    }))).toThrow("human content operator required");
    expect(() => runWithTenant(operatorScope, () => resolveOperationAggregate({
      operation, command, claim, job, evidence: [artifact], choice: "cancel", reason: "A sufficiently detailed reason.", expectedEpoch: 1, now,
    }))).toThrow("epoch");
    expect(() => runWithTenant(operatorScope, () => resolveOperationAggregate({
      operation, command, claim, job, evidence: [{ ...artifact, state: "failed" }], choice: "cancel", reason: "A sufficiently detailed reason.", expectedEpoch: 2, now,
    }))).toThrow("ready audit evidence");
  });
});
