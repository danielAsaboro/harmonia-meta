import { describe, expect, it } from "vitest";

import { reduceBatchOutcome } from "@/lib/dataPlane/fanIn";
import type { DataWorkItemState } from "@/lib/dataPlane/contracts";

describe("data-plane fan-in", () => {
  it("distinguishes running, complete, partial, failed, and cancelled batches", () => {
    const outcome = (states: DataWorkItemState[], allowPartial = true, minimumSuccessRatio = 0.5) =>
      reduceBatchOutcome(states.map((state, index) => ({ id: `item-${index}`, state })), { allowPartial, minimumSuccessRatio });

    expect(outcome(["succeeded", "pending"]).outcome).toBe("running");
    expect(outcome(["succeeded", "succeeded"]).outcome).toBe("complete");
    expect(outcome(["succeeded", "dead_lettered"]).outcome).toBe("partial");
    expect(outcome(["succeeded", "dead_lettered"], false).outcome).toBe("failed");
    expect(outcome(["dead_lettered", "dead_lettered"]).outcome).toBe("failed");
    expect(outcome(["cancelled", "cancelled"]).outcome).toBe("cancelled");
  });

  it("reports literal counts and rejects empty or invalid policies", () => {
    expect(reduceBatchOutcome([
      { id: "a", state: "succeeded" },
      { id: "b", state: "dead_lettered" },
      { id: "c", state: "cancelled" },
    ], { allowPartial: true, minimumSuccessRatio: 0.3 })).toMatchObject({
      counts: { total: 3, succeeded: 1, failed: 1, cancelled: 1, active: 0 },
      successRatio: 1 / 3,
    });
    expect(() => reduceBatchOutcome([], { allowPartial: true, minimumSuccessRatio: 1 })).toThrow("at least one");
    expect(() => reduceBatchOutcome([{ id: "a", state: "succeeded" }], { allowPartial: true, minimumSuccessRatio: 1.1 })).toThrow("ratio");
  });
});
