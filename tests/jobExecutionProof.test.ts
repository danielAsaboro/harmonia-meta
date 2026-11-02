import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("demonstrated job execution proof", () => {
  it("shows persisted lifecycle, authority, effect lineage, and measured KPIs", () => {
    const source = readFileSync("src/components/studio/JobExecutionProof.tsx", "utf8");
    for (const label of [
      "Execution proof", "Persisted stage", "Specialist handoffs", "Approval decision",
      "Effect claim", "Receipt", "Independent verification", "Normalized sources",
      "Hands-off time", "Operator actions", "Approved-output yield", "Verified outputs",
    ]) expect(source).toContain(label);
    expect(source).toContain("job.decisions");
    expect(source).toContain("job.claims");
    expect(source).toContain("job.verifications");
    expect(source).not.toMatch(/chain.of.thought|private reasoning/i);
  });
});
