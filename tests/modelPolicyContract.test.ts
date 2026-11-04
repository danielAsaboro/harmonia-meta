import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { budgetReservationSchema, usageRecordSchema } from "@/lib/contracts";

// The worker's real policy snapshots (agent/tests/fixtures/model_policies.json,
// kept current by agent/tests/test_model_policy_contract.py).
const policies = JSON.parse(readFileSync(new URL("../agent/tests/fixtures/model_policies.json", import.meta.url), "utf8")) as Record<string, unknown>;

describe("worker model policy contract", () => {
  it.each(Object.entries(policies))("accepts the worker's %s policy on reservations and usage", (role, modelPolicy) => {
    const reservation = {
      jobId: "j1", operationId: `j1:understand:${role}`, stage: "understand", role,
      model: "muse-spark-1.3", estimatedCostUsd: "0.010000", pricingVersion: "2026-11-03", modelPolicy,
    };
    expect(budgetReservationSchema.safeParse(reservation).success).toBe(true);
    expect(usageRecordSchema.safeParse({
      ...reservation, id: "u1", inputUnits: 100, outputUnits: 10, unitType: "tokens",
      traceId: "a".repeat(32), createdAt: "2026-11-04T15:00:00Z",
    }).success).toBe(true);
  });
});
