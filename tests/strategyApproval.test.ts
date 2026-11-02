import { describe, expect, it } from "vitest";
import { applyStrategyDecision, assertStrategyProposalRevision, strategyDigest } from "@/lib/strategyApproval";

const strategy = { strategyId: "s1", version: 1, horizonWeeks: 4, thesis: "proof" };

describe("strategy approval", () => {
  it("binds approval to canonical strategy JSON", () => {
    expect(strategyDigest({ b: 2, a: 1 })).toBe(strategyDigest({ a: 1, b: 2 }));
  });

  it("approves only the exact current digest", () => {
    const digest = strategyDigest(strategy);
    const current = { revision: 1, strategyDigest: digest, approvalExpiresAt: "2026-08-28T00:00:00.000Z" };
    const result = applyStrategyDecision(current, { decision: "approved", payloadDigest: digest }, "operator-1", new Date("2026-08-27T00:00:00Z"));
    expect(result).toMatchObject({ nextStage: "plan", approval: { decision: "approved", payloadDigest: digest, revision: 1 } });
    expect(() => applyStrategyDecision(current, { decision: "approved", payloadDigest: "a".repeat(64) }, "operator-1", new Date("2026-08-27T00:00:00Z"))).toThrow("strategy payload changed");
    expect(() => applyStrategyDecision(current, { decision: "approved", payloadDigest: digest }, "operator-1", new Date("2026-08-29T00:00:00Z"))).toThrow("strategy approval expired");
  });

  it("requires feedback for one revision and terminates after the second rejection", () => {
    const digest = strategyDigest(strategy);
    const expiry = "2099-01-01T00:00:00.000Z";
    expect(() => applyStrategyDecision({ revision: 1, strategyDigest: digest, approvalExpiresAt: expiry }, { decision: "rejected", payloadDigest: digest }, "operator-1", new Date())).toThrow("rejection feedback required");
    expect(applyStrategyDecision({ revision: 1, strategyDigest: digest, approvalExpiresAt: expiry }, { decision: "rejected", payloadDigest: digest, feedback: "Narrow the audience" }, "operator-1", new Date())).toMatchObject({ nextStage: "strategize", nextRevision: 2 });
    expect(applyStrategyDecision({ revision: 2, strategyDigest: digest, approvalExpiresAt: expiry }, { decision: "rejected", payloadDigest: digest, feedback: "Still too broad" }, "operator-1", new Date())).toMatchObject({ nextStage: "complete", terminalOutcome: "rejected" });
  });

  it("rejects stale proposals after revision is incremented", () => {
    expect(() => assertStrategyProposalRevision("strategize", 2, 1, 1)).toThrow("stale strategy revision");
    expect(() => assertStrategyProposalRevision("strategize", 2, 2, 2)).not.toThrow();
    expect(() => assertStrategyProposalRevision("awaiting_strategy_approval", 2, 2, 2)).toThrow("job stage");
  });
});
