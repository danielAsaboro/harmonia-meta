import { describe, expect, it } from "vitest";
import {
  applyFinalizedUsage,
  applyReleasedReservation,
  applyReservation,
  aggregateModelUsage,
  canReserve,
  exceedsApprovalThreshold,
  summarizeUsage,
} from "@/lib/costs";
import type { JobBudget } from "@/lib/types";

const budget: JobBudget = {
  estimatedUsd: "0.20",
  observedUsd: "0.10",
  reservedUsd: "0.10",
  limitUsd: "0.30",
  approvalThresholdUsd: "0.20",
};

describe("job budgets", () => {
  it("rejects a reservation above the remaining limit", () => {
    expect(canReserve(budget, "0.11")).toBe(false);
  });

  it("requires separate authorization above the configured cost threshold", () => {
    expect(exceedsApprovalThreshold(budget, "0.20")).toBe(false);
    expect(exceedsApprovalThreshold(budget, "0.200001")).toBe(true);
  });

  it("reserves and finalizes usage without binary rounding drift", () => {
    const reserved = applyReservation(
      { ...budget, observedUsd: "0.00", reservedUsd: "0.00", estimatedUsd: "0.00" },
      "0.11",
    );
    expect(reserved).toMatchObject({ estimatedUsd: "0.11", reservedUsd: "0.11" });

    const finalized = applyFinalizedUsage(reserved, "0.11", "0.105001");
    expect(finalized).toMatchObject({ reservedUsd: "0.00", observedUsd: "0.105001" });
  });

  it("releases an unused reservation without recording spend", () => {
    const reserved = applyReservation(
      { ...budget, observedUsd: "0.00", reservedUsd: "0.00", estimatedUsd: "0.00" },
      "0.11",
    );

    expect(applyReleasedReservation(reserved, "0.11")).toMatchObject({
      estimatedUsd: "0.11",
      reservedUsd: "0.00",
      observedUsd: "0.00",
    });
  });

  it("refuses to release more than remains reserved", () => {
    expect(() => applyReleasedReservation(budget, "0.11")).toThrow(
      "release exceeds reserved job amount",
    );
  });

  it("aggregates decimal strings by model", () => {
    expect(summarizeUsage([
      { model: "m1", estimatedCostUsd: "0.10" },
      { model: "m1", estimatedCostUsd: "0.20" },
      { model: "m2", estimatedCostUsd: "0.005001" },
    ])).toEqual({
      totalEstimatedUsd: "0.305001",
      byModel: { m1: "0.30", m2: "0.005001" },
    });
  });

  it("aggregates usage by model and role with microdollar precision", () => {
    const records = [
      {
        model: "gemini-3.5-flash", role: "analyst", inputUnits: 100,
        outputUnits: 20, estimatedCostUsd: "0.000330", observedCostUsd: "0.000300",
      },
      {
        model: "gemini-3.5-flash", role: "analyst", inputUnits: 50,
        outputUnits: 10, estimatedCostUsd: "0.000165",
      },
      {
        model: "gemini-3.5-flash-lite", role: "strategist", inputUnits: 10,
        outputUnits: 2, estimatedCostUsd: "0.000008",
      },
    ];

    expect(aggregateModelUsage(records)).toEqual({
      modelUsage: [
        {
          model: "gemini-3.5-flash", role: "analyst", calls: 2,
          inputUnits: 150, outputUnits: 30, estimatedCostUsd: "0.000495",
        },
        {
          model: "gemini-3.5-flash-lite", role: "strategist", calls: 1,
          inputUnits: 10, outputUnits: 2, estimatedCostUsd: "0.000008",
        },
      ],
      estimatedUsd: "0.000503",
      observedUsd: "0.0003",
    });
  });
});
