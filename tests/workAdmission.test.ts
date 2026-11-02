import { describe, expect, it } from "vitest";

import { decideWorkAdmission } from "@/lib/operations/workAdmission";

describe("cooperative work admission", () => {
  it("admits new stage and effect work only while the canonical control state is running", () => {
    expect(decideWorkAdmission("running")).toEqual({ outcome: "execute" });
    expect(decideWorkAdmission("paused")).toEqual({ outcome: "paused" });
    expect(decideWorkAdmission("cancelled")).toEqual({ outcome: "cancelled" });
  });
});
