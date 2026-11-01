import { describe, expect, it } from "vitest";

import { parseBudgetConfig } from "@/lib/config";

describe("budget configuration", () => {
  it("does not require unrelated runtime credentials to construct durable job defaults", () => {
    expect(parseBudgetConfig({})).toEqual({
      DEFAULT_JOB_BUDGET_USD: "5.00",
      DEFAULT_JOB_APPROVAL_THRESHOLD_USD: "0.25",
      DEFAULT_WORKSPACE_BUDGET_USD: "100.00",
    });
  });
});
