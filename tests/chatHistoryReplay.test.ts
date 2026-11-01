import { describe, expect, it } from "vitest";
import { historyRunState } from "../src/lib/a2ui/historyReplay";

describe("historyRunState", () => {
  it("hydrates a persisted assistant message from its linked run events", () => {
    const state = historyRunState("demo-run", [
      { type: "run_started", runId: "demo-run", sequence: 0, startedAt: "2026-08-23T08:00:00.000Z" },
      { type: "run_completed", runId: "demo-run", sequence: 1, completedAt: "2026-08-23T08:00:01.000Z", reply: "Ready." },
    ]);
    expect(state).toMatchObject({ runId: "demo-run", status: "complete", text: "Ready." });
  });

  it("turns invalid persisted protocol data into a visible permanent failure", () => {
    const state = historyRunState("demo-run", [
      { type: "activity", runId: "demo-run", sequence: 0, activity: { id: "analyst", label: "Analyze", status: "not-valid" } },
    ]);
    expect(state.status).toBe("failed");
    expect(state.permanent).toBe(true);
    expect(state.error).toMatch(/protocol replay failed/i);
  });
});
