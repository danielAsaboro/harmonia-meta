import { describe, expect, it } from "vitest";
import { verifyVerticalSliceEvidence } from "@/lib/verticalSliceEvidence";
describe("replay evidence classification", () => {
  it.each(["fixture", "recorded_replay", "historical_replay"])("rejects %s as fresh proof", (classification) => {
    const result = verifyVerticalSliceEvidence({ executionMode: classification, evidenceClassification: classification });
    expect(result.failures.some((failure) => failure.code === "replay_not_fresh_evidence")).toBe(true);
  });
});
