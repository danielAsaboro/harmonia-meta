import { describe, expect, it } from "vitest";
import { describeStep } from "@/components/proof/RunReplay";

describe("run replay labels", () => {
  it("says what each recorded event means in plain words", () => {
    expect(describeStep({ offsetMs: 0, kind: "stage_transition", payload: { stage: "awaiting_approval", status: "waiting" } }).label).toBe("Stage: awaiting approval (waiting)");
    expect(describeStep({ offsetMs: 0, kind: "usage", payload: { model: "muse-spark-1.3", inputTokens: 1000, outputTokens: 200, estimatedCostUsd: 0.0123 } }))
      .toEqual({ label: "muse-spark-1.3 call", body: "1,200 tokens, $0.0123", tone: "model" });
    expect(describeStep({ offsetMs: 0, kind: "usage", payload: { model: "sam-3.1", inputTokens: 0, outputTokens: 0, estimatedCostUsd: 0.0264 } }).body).toBe("$0.0264");
    expect(describeStep({ offsetMs: 0, kind: "approval", payload: { actionId: "export-1", decision: "approved" } }).tone).toBe("human");
    expect(describeStep({ offsetMs: 0, kind: "verification", payload: { receiptId: "r", verified: true, method: "digest read-back" } }).label).toBe("Independent check passed");
  });
});
