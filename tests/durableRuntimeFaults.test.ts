import { describe, expect, it } from "vitest";

import { runDurableRuntimeBenchmark } from "@/lib/durableRuntimeVerification";

describe("deterministic durable runtime fault benchmark", () => {
  it("covers every crash boundary without duplicate effects or silent context loss", () => {
    const report = runDurableRuntimeBenchmark();
    expect(report.schemaVersion).toBe(1);
    expect(report.boundaries).toEqual([
      "before_inbox_acceptance", "after_inbox_acceptance", "after_operation_claim",
      "after_projection_persistence", "after_model_result", "after_effect_preparation",
      "after_provider_dispatch", "after_provider_response", "after_receipt_commit", "after_verification",
    ]);
    expect(report.metrics).toMatchObject({
      duplicateTransitions: 0, duplicateEffects: 0, unknownOutcomes: 1,
      staleWriteRejections: 1, constraintsSurvived: 3, currentRevisionAccuracy: 1,
      artifactDigestChecks: 2, recoveryUnits: 4, auditCompleteness: "10/10",
    });
    expect(report.metrics.promptVolumeChars).toBeLessThanOrEqual(2400);
  });

  it("is byte-for-byte deterministic across repeated runs", () => {
    expect(JSON.stringify(runDurableRuntimeBenchmark())).toBe(JSON.stringify(runDurableRuntimeBenchmark()));
  });
});
