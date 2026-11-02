import { describe, expect, it } from "vitest";

import { compileJobShells } from "@/lib/operations/projection";

describe("operational projection compiler", () => {
  it("joins durable attention and unknown effects into compact job shells", () => {
    const shells = compileJobShells({
      jobs: [{ id: "job-1", status: "running", stage: "draft", controlState: "running", controlEpoch: 2, updatedAt: "2026-08-31T00:00:00.000Z", actions: [{ approvalState: "pending" }] }],
      attention: [{ id: "attention:missing_asset:a", kind: "missing_asset", jobId: "job-1" }],
      unknownEffects: [{ jobId: "job-1" }],
      lastEventSequence: 7,
    });
    expect(shells).toHaveLength(1);
    expect(shells[0]).toMatchObject({ lifecycle: "uncertain", approvalCount: 1, attentionCount: 3, unknownEffectCount: 1, lastEventSequence: 7 });
  });
});
