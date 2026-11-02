import { describe, expect, it } from "vitest";

import { verifyVerticalSliceEvidence } from "@/lib/verticalSliceEvidence";

const workflowTraceId = "a".repeat(32);
const approvalTraceId = "c".repeat(32);
const replayTraceId = "d".repeat(32);
const digest = "b".repeat(64);

function validBundle() {
  const stages = [
    "collect_sources", "extract_sources", "understand", "draft",
    "awaiting_approval", "publish", "verify",
  ] as const;
  return {
    schemaVersion: "harmonia.vertical-slice-evidence.v1",
    runId: "run-20260824-001",
    capturedAt: "2026-08-24T12:20:00.000Z",
    source: { kind: "source_manifest", manifestId: "manifest-1", sourceIds: ["public-video-id"], manifestDigest: digest },
    environment: {
      projectId: "harmonia-prod",
      location: "us-central1",
      webService: "harmonia-web",
      webRevision: "harmonia-web-00001-abc",
      agentService: "harmonia-agent",
      agentRevision: "harmonia-agent-00001-def",
      agentEngineResource: "projects/123/locations/us-central1/reasoningEngines/456",
      firestoreDatabase: "projects/harmonia-prod/databases/(default)",
      pubsubTopic: "projects/harmonia-prod/topics/harmonia-stages",
      mockAi: false,
      mockEffects: false,
      emulator: false,
    },
    job: {
      workspaceId: "workspace-1", brandId: "brand-1", jobId: "job-1",
      createdAt: "2026-08-24T12:00:00.000Z",
      completedAt: "2026-08-24T12:18:00.000Z",
    },
    metrics: {
      sourceCount: 900,
      elapsedSec: 1080,
      handsOffProcessingSec: 1020,
      approvalWaitSec: 60,
      operatorActionCount: 1,
      outputCount: 3,
      approvedOutputCount: 1,
      verifiedOutputCount: 1,
    },
    events: stages.map((stage, index) => ({
      eventId: `event-${index}`, stage,
      status: stage === "awaiting_approval" ? "waiting" : "completed",
      at: new Date(Date.parse("2026-08-24T12:01:00.000Z") + index * 60_000).toISOString(),
      operationId: `job-1:${stage}:0`,
      pubsubMessageId: `message-${index}`,
      traceId: index >= 5 ? approvalTraceId : workflowTraceId,
    })),
    cognition: [
      {
        role: "harmonia_coordinator", model: "gemini-3.5-flash-lite",
        provider: "gemini", policyVersion: "gear-2026-11-03",
        usageRecordId: "usage-coordinator", operationId: "job-1:understand:0:harmonia_coordinator",
        traceId: workflowTraceId,
      },
      {
        role: "nimi_analyst", model: "gemini-3.5-flash",
        provider: "gemini", policyVersion: "gear-2026-11-03",
        usageRecordId: "usage-analyst", operationId: "job-1:understand:0:nimi_analyst",
        traceId: workflowTraceId,
      },
    ],
    approval: {
      approvalId: "approval-1", actionId: "action-1", decision: "approved",
      actorType: "firebase_operator", decidedAt: "2026-08-24T12:10:00.000Z", traceId: approvalTraceId,
    },
    claim: {
      claimId: digest, actionId: "action-1", idempotencyKey: digest,
      state: "applied", receiptId: "receipt-1", attempt: 1,
      claimedAt: "2026-08-24T12:10:30.000Z", finalizedAt: "2026-08-24T12:11:30.000Z",
      operationId: "job-1:publish:action-1", traceId: approvalTraceId,
    },
    effect: {
      actionId: "action-1", operationId: "job-1:publish:action-1",
      idempotencyKey: digest, receiptId: "receipt-1", kind: "export_content_artifact",
      outcome: "applied", executedAt: "2026-08-24T12:11:00.000Z",
      artifactDigest: digest, traceId: approvalTraceId,
    },
    verification: {
      verificationId: "verification-1", receiptId: "receipt-1",
      operationId: "job-1:verify:action-1",
      method: "artifact_digest_reread", status: "verified",
      checkedAt: "2026-08-24T12:12:00.000Z", observedDigest: digest, traceId: approvalTraceId,
    },
    replay: {
      operationId: "job-1:publish:action-1:replay",
      receiptId: "receipt-1", outcome: "already_applied",
      attemptedAt: "2026-08-24T12:13:00.000Z", traceId: replayTraceId,
    },
    costs: {
      pricingVersion: "2026-08-23", currency: "USD",
      records: [
        { usageRecordId: "usage-coordinator", operationId: "job-1:understand:0:harmonia_coordinator", estimatedUsd: "0.010000", observedUsd: "0.009000" },
        { usageRecordId: "usage-analyst", operationId: "job-1:understand:0:nimi_analyst", estimatedUsd: "0.020000", observedUsd: "0.018000" },
      ],
      totalEstimatedUsd: "0.030000", totalObservedUsd: "0.027000",
    },
    evidenceFiles: [
      { kind: "job_export", relativePath: "exports/job.json", sha256: digest },
      { kind: "trace_export", relativePath: "exports/trace.json", sha256: digest },
    ],
  };
}

function failureCodes(bundle: unknown) {
  return verifyVerticalSliceEvidence(bundle).failures.map((failure) => failure.code);
}

describe("vertical-slice evidence", () => {
  it("accepts a complete authenticated redacted bundle", () => {
    expect(verifyVerticalSliceEvidence(validBundle())).toEqual({ ok: true, failures: [] });
  });

  it.each([
    ["mockAi"], ["mockEffects"], ["emulator"],
  ] as const)("rejects non-production provenance: %s", (field) => {
    const bundle = validBundle();
    bundle.environment[field] = true;
    expect(failureCodes(bundle)).toContain("non_production_provenance");
  });

  it("rejects missing or non-Gemini-3.5 cognition", () => {
    const bundle = validBundle();
    bundle.environment.agentEngineResource = "not-an-agent-engine-resource";
    bundle.cognition[1].model = "gemini-2.5-flash";
    expect(failureCodes(bundle)).toEqual(expect.arrayContaining([
      "missing_agent_engine", "missing_required_gemini",
    ]));
  });

  it("requires internally consistent demonstrated-job KPIs", () => {
    const missing = validBundle() as Record<string, unknown>;
    delete missing.metrics;
    expect(failureCodes(missing)).toContain("schema_invalid");

    const inconsistent = validBundle();
    inconsistent.metrics.handsOffProcessingSec = 1000;
    inconsistent.metrics.approvedOutputCount = 4;
    inconsistent.metrics.verifiedOutputCount = 5;
    expect(failureCodes(inconsistent)).toEqual(expect.arrayContaining([
      "elapsed_time_mismatch", "approved_output_overflow", "verified_output_overflow",
    ]));
  });

  it("rejects missing, reordered, and cognition traces unlinked from lifecycle events", () => {
    const missing = validBundle();
    missing.events = missing.events.filter((event) => event.stage !== "draft");
    expect(failureCodes(missing)).toContain("missing_stage");

    const reordered = validBundle();
    [reordered.events[1], reordered.events[2]] = [reordered.events[2], reordered.events[1]];
    expect(failureCodes(reordered)).toContain("stage_order_invalid");

    const orphaned = validBundle();
    orphaned.cognition[0].traceId = "e".repeat(32);
    expect(failureCodes(orphaned)).toContain("cognition_trace_unlinked");
  });

  it("rejects missing trace context and broken approval-effect-verification lineage", () => {
    const missing = validBundle();
    missing.events[0].traceId = "0".repeat(32);
    expect(failureCodes(missing)).toContain("missing_trace_context");

    const broken = validBundle();
    broken.effect.traceId = "e".repeat(32);
    broken.verification.traceId = "f".repeat(32);
    expect(failureCodes(broken)).toEqual(expect.arrayContaining([
      "approval_effect_trace_mismatch", "effect_verification_trace_mismatch",
    ]));
  });

  it("allows non-Pub/Sub lifecycle events but requires real Pub/Sub evidence", () => {
    const partial = validBundle();
    partial.events[4] = { ...partial.events[4], pubsubMessageId: undefined as unknown as string };
    expect(failureCodes(partial)).not.toContain("missing_pubsub_evidence");

    const absent = validBundle();
    absent.events = absent.events.map((event) => ({
      ...event,
      pubsubMessageId: undefined as unknown as string,
    }));
    expect(failureCodes(absent)).toContain("missing_pubsub_evidence");
  });

  it("rejects effect execution before durable human approval", () => {
    const bundle = validBundle();
    bundle.approval.decidedAt = "2026-08-24T12:12:00.000Z";
    expect(failureCodes(bundle)).toContain("effect_before_approval");
  });

  it("requires a finalized pre-effect claim linked to the applied receipt", () => {
    const bundle = validBundle();
    bundle.claim.actionId = "different-action";
    bundle.claim.receiptId = "different-receipt";
    bundle.claim.claimedAt = "2026-08-24T12:12:00.000Z";
    expect(failureCodes(bundle)).toEqual(expect.arrayContaining([
      "claim_action_mismatch", "claim_receipt_mismatch", "claim_after_effect",
    ]));
  });

  it("rejects mismatched actions, receipts, digests, and unverified effects", () => {
    const bundle = validBundle();
    bundle.effect.actionId = "different-action";
    bundle.verification.receiptId = "different-receipt";
    bundle.verification.observedDigest = "d".repeat(64);
    bundle.verification.status = "failed";
    expect(failureCodes(bundle)).toEqual(expect.arrayContaining([
      "action_mismatch", "receipt_mismatch", "artifact_digest_mismatch",
      "effect_not_verified",
    ]));
  });

  it("rejects verification before execution and duplicate operation IDs", () => {
    const bundle = validBundle();
    bundle.verification.checkedAt = "2026-08-24T12:10:30.000Z";
    bundle.events[1].operationId = bundle.events[0].operationId;
    bundle.verification.operationId = bundle.effect.operationId;
    expect(failureCodes(bundle)).toEqual(expect.arrayContaining([
      "verification_before_effect", "duplicate_operation_id", "verification_operation_reused",
    ]));
  });

  it("requires replay to prove duplicate-effect prevention", () => {
    const bundle = validBundle();
    bundle.replay.receiptId = "new-receipt";
    bundle.replay.outcome = "applied" as "already_applied";
    bundle.replay.attemptedAt = "2026-08-24T12:10:00.000Z";
    bundle.replay.traceId = bundle.effect.traceId;
    expect(failureCodes(bundle)).toEqual(expect.arrayContaining([
      "replay_receipt_mismatch", "duplicate_effect_on_replay", "replay_before_effect",
      "replay_trace_reused",
    ]));
  });

  it("rejects unknown or unreconciled cost", () => {
    const unknown = validBundle();
    unknown.costs.records[0].observedUsd = null as unknown as string;
    expect(failureCodes(unknown)).toContain("schema_invalid");

    const mismatch = validBundle();
    mismatch.costs.totalObservedUsd = "0.999999";
    expect(failureCodes(mismatch)).toContain("cost_total_mismatch");
  });

  it("rejects missing usage links and private/raw fields", () => {
    const missingUsage = validBundle();
    missingUsage.costs.records.pop();
    expect(failureCodes(missingUsage)).toContain("missing_usage_record");

    const leaked = { ...validBundle(), transcript: "private source text" };
    expect(failureCodes(leaked)).toContain("schema_invalid");
  });
});
