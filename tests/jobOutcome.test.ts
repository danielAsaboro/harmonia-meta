import { describe, expect, it } from "vitest";
import { decideTerminalOutcome } from "@/lib/effectCommands";

describe("job business outcome", () => {
  it("marks workflow completion with mixed applied and failed effects as partial", () => {
    expect(decideTerminalOutcome([{ state: "applied" }, { state: "failed" }])).toBe("partial");
  });

  it("never calls an uncertain effect successful", () => {
    expect(decideTerminalOutcome([{ state: "applied" }, { state: "unknown" }])).toBe("unresolved");
  });
});
