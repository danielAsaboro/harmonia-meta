import { describe, expect, it } from "vitest";
import {
  analysisSubmissionSchema,
  budgetReservationSchema,
  budgetReservationResolutionSchema,
  failureSubmissionSchema,
  receiptSubmissionSchema,
  stageExecutionClaimSchema,
  stageExecutionFinalizeSchema,
  strategyInvocationContextSchema,
  usageRecordSchema,
  verificationSubmissionSchema,
} from "@/lib/contracts";

describe("internal contracts", () => {
  it("accepts complete multi-segment strategy evidence across the Python-TypeScript boundary", () => {
    expect(strategyInvocationContextSchema.safeParse({
      jobId: "job-1", stage: "strategize", revision: 1,
      sourceIds: Array.from({ length: 53 }, (_, index) => `segment-${index + 1}`),
      operatorContextIds: ["context:company", "context:campaign"],
      performance: [], memoryFacts: [], audienceIds: ["founders"],
      requestedChannels: ["x"], supportedChannels: ["x"], horizonWeeks: 4,
      researchRequest: null, searchEvidence: [],
    }).success).toBe(true);
  });

  it("accepts provider-default sampling in Gemini 3.7 budget and usage evidence", () => {
    const reservation = {
      jobId: "j1", operationId: "j1:understand:nimi:0", stage: "understand",
      role: "nimi", model: "gemini-3.7-flash",
      estimatedCostUsd: "0.001000", pricingVersion: "2026-11-03",
      modelPolicy: {
        policyVersion: "gear-2026-11-03", pricingVersion: "2026-11-03",
        temperature: null, topP: null, topK: null,
        safetyProfile: "harmonia-standard", maxOutputTokens: 2048,
        timeoutSeconds: 120, eligibleTasks: ["analyze_media"], minimumPassRate: "0.95",
      },
    };
    expect(budgetReservationSchema.parse(reservation).modelPolicy?.temperature).toBeNull();
    expect(usageRecordSchema.parse({
      ...reservation, id: "u1", inputUnits: 100, outputUnits: 10,
      unitType: "tokens", traceId: "a".repeat(32), createdAt: "2026-09-02T20:00:00Z",
    }).modelPolicy?.temperature).toBeNull();
  });

  it("preserves additive visual grounding on analyzed moments", () => {
    const parsed = analysisSubmissionSchema.parse({
      jobId: "j1",
      stage: "understand",
      analysis: {
        sourceDigest: "a".repeat(64), summary: "Visible product demo",
        moments: [{
          id: "m1", title: "Dashboard reveal", startSec: 2, endSec: 9,
          hook: "Watch the state change", quote: "The workflow is now live",
          sourceSegmentRefs: ["segment-1"],
          visualHook: "Dashboard counter changes from zero to one",
          cropSuitability: "excellent", captionSafeRegion: "lower third",
          visualEvidenceIds: ["f1"], assumptions: [], confidence: "high",
        }],
        angles: [], assumptions: [], confidence: "high",
      },
      analysisDigest: "b".repeat(64),
      modelUsed: "gemini-3.5-flash",
      researchRequest: null,
      searchEvidence: [],
      searchProvenance: null,
    });

    expect(parsed.analysis.moments[0].visualEvidenceIds).toEqual(["f1"]);
    expect(parsed.analysis.moments[0].cropSuitability).toBe("excellent");
  });

  it("rejects receipts for unknown action types", () => {
    const parsed = receiptSubmissionSchema.safeParse({
      jobId: "j1", actionId: "a1", actionType: "github_upsert_file",
      idempotencyKey: "k".repeat(32), operationId: "j1:publish:a1",
      traceId: "a".repeat(32), outcome: "applied", detail: {},
    });
    expect(parsed.success).toBe(false);
  });

  it("requires durable verification lineage metadata", () => {
    const result = {
      target: "content-pack", actionId: "a1", receiptId: "r1",
      operationId: "j1:verify:a1", traceId: "a".repeat(32),
      verified: true, method: "artifact_digest_reread",
      evidence: { kind: "firestore_doc", url: "", fetchedAt: "2026-08-25T00:00:00Z", digest: "b".repeat(64) },
    };
    expect(verificationSubmissionSchema.safeParse({ jobId: "j1", results: [result] }).success).toBe(true);
    expect(verificationSubmissionSchema.safeParse({
      jobId: "j1", results: [{ ...result, receiptId: undefined }],
    }).success).toBe(false);
    expect(verificationSubmissionSchema.safeParse({
      jobId: "j1", results: [{ ...result, traceId: "0".repeat(32) }],
    }).success).toBe(false);
  });

  it("accepts strict budget reservations and usage records", () => {
    const modelPolicy = {
      policyVersion: "gear-2026-11-03", pricingVersion: "2026-08-23",
      temperature: 0.2, topP: 0.9, topK: null,
      safetyProfile: "harmonia-standard", maxOutputTokens: 2048,
      timeoutSeconds: 120, eligibleTasks: ["analyze_media"],
      minimumPassRate: "0.95",
    };
    expect(budgetReservationSchema.safeParse({
      jobId: "j1", operationId: "j1:draft:nimi:0", stage: "draft",
      role: "nimi", model: "gemini-3.5-flash",
      estimatedCostUsd: "0.001000", pricingVersion: "2026-08-23",
      modelPolicy,
    }).success).toBe(true);
    expect(budgetReservationSchema.safeParse({
      jobId: "j1", operationId: "j1:draft:nimi:0", stage: "draft",
      role: "nimi", model: "muse-spark-1.3",
      estimatedCostUsd: "0.001000", pricingVersion: "2026-11-03",
      productionAuthorization: { planId: "plan-1" },
    }).success).toBe(false);
    expect(usageRecordSchema.safeParse({
      id: "u1", jobId: "j1", operationId: "j1:draft:nimi:0", stage: "draft",
      role: "nimi", model: "gemini-3.5-flash", inputUnits: 100, outputUnits: 10,
      unitType: "tokens", estimatedCostUsd: "0.000240",
      pricingVersion: "2026-08-23", traceId: "a".repeat(32),
      modelPolicy,
      createdAt: "2026-08-23T12:00:00+00:00",
    }).success).toBe(true);
  });

  it("accepts only explicit no-call release or uncertain reservation outcomes", () => {
    expect(budgetReservationResolutionSchema.safeParse({
      jobId: "j1", operationId: "j1:draft:nimi:0", outcome: "not_invoked",
      reason: "provider validation failed before request dispatch",
    }).success).toBe(true);
    expect(budgetReservationResolutionSchema.safeParse({
      jobId: "j1", operationId: "j1:draft:nimi:0", outcome: "uncertain",
      reason: "request timed out after dispatch",
    }).success).toBe(true);
    expect(budgetReservationResolutionSchema.safeParse({
      jobId: "j1", operationId: "j1:draft:nimi:0", outcome: "released",
      reason: "ambiguous",
    }).success).toBe(false);
  });

  it("requires opaque tokens and bounded outcomes for stage execution leases", () => {
    expect(stageExecutionClaimSchema.safeParse({
      jobId: "j1", stage: "draft", operationId: "job:j1:stage:draft:generation:0", ownerId: "worker-1", claimToken: "s".repeat(32),
    }).success).toBe(true);
    expect(stageExecutionFinalizeSchema.safeParse({
      jobId: "j1", stage: "draft", operationId: "job:j1:stage:draft:generation:0", claimToken: "s".repeat(32), outcome: "applied",
    }).success).toBe(true);
    expect(stageExecutionFinalizeSchema.safeParse({
      jobId: "j1", stage: "draft", claimToken: "short", outcome: "retry",
    }).success).toBe(false);
  });

  it("rejects unpriced-looking amounts and malformed trace ids", () => {
    expect(budgetReservationSchema.safeParse({
      jobId: "j1", operationId: "op", stage: "draft", role: "nimi", model: "m",
      estimatedCostUsd: "free", pricingVersion: "2026-08-23",
    }).success).toBe(false);
    expect(usageRecordSchema.safeParse({
      id: "u1", jobId: "j1", operationId: "op", stage: "draft", role: "nimi",
      model: "m", inputUnits: 1, outputUnits: 1, unitType: "tokens",
      estimatedCostUsd: "0.01", pricingVersion: "2026-08-23", traceId: "short",
      createdAt: "2026-08-23T12:00:00+00:00",
    }).success).toBe(false);
  });

  it("requires a complete typed failure envelope", () => {
    const valid = {
      jobId: "j1", stage: "draft", category: "provider_transient",
      code: "provider_timeout", publicMessage: "The provider timed out.",
      retryable: true, operationId: "j1:draft:0", traceId: "a".repeat(32),
      attempt: 0, maxAttempts: 3, details: { exceptionType: "ReadTimeout" },
    };
    expect(failureSubmissionSchema.safeParse(valid).success).toBe(true);
    expect(failureSubmissionSchema.safeParse({ ...valid, error: "token=secret" }).success).toBe(false);
    expect(failureSubmissionSchema.safeParse({ ...valid, category: "mystery" }).success).toBe(false);
    expect(failureSubmissionSchema.safeParse({ ...valid, details: { responseBody: "secret" } }).success).toBe(false);
  });
});
