import { describe, expect, it } from "vitest";
import { eventsSince } from "@/components/studio/SinceLastVisit";

describe("studio return summary", () => {
  it("returns only persisted events newer than the previous visit", () => {
    const events = [
      { at: "2026-09-04T09:00:00.000Z", stage: "draft", actor: "agent", message: "Drafted the launch post" },
      { at: "2026-09-04T10:00:00.000Z", stage: "awaiting_approval", actor: "system", message: "Approval is ready" },
    ];
    expect(eventsSince(events, "2026-09-04T09:30:00.000Z").map((event) => event.message)).toEqual(["Approval is ready"]);
  });

  it("treats a missing or invalid previous visit as no return summary", () => {
    expect(eventsSince([{ at: "2026-09-04T10:00:00.000Z", stage: "draft", actor: "agent", message: "Drafted" }], null)).toEqual([]);
    expect(eventsSince([{ at: "2026-09-04T10:00:00.000Z", stage: "draft", actor: "agent", message: "Drafted" }], "not-a-date")).toEqual([]);
  });
});
