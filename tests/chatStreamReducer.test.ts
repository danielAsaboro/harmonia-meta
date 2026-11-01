import { describe, expect, test } from "vitest";
import { initialChatRunState, reduceChatStreamEvent } from "../src/lib/a2ui/chatReducer";

describe("chat stream reducer", () => {
  test("assembles deltas and live activity in sequence", () => {
    let state = initialChatRunState("run-1");
    state = reduceChatStreamEvent(state, { type: "text_delta", runId: "run-1", sequence: 1, delta: "Hello " });
    state = reduceChatStreamEvent(state, { type: "text_delta", runId: "run-1", sequence: 2, delta: "world" });
    state = reduceChatStreamEvent(state, { type: "activity", runId: "run-1", sequence: 3, activity: { id: "analyst", label: "Analyze", status: "active" } });
    state = reduceChatStreamEvent(state, { type: "activity", runId: "run-1", sequence: 4, activity: { id: "analyst", label: "Analyze", status: "complete" } });
    expect(state.text).toBe("Hello world");
    expect(state.activities).toEqual([{ id: "analyst", label: "Analyze", status: "complete" }]);
  });

  test("ignores replayed events and retains A2UI operations", () => {
    let state = initialChatRunState("run-1");
    const event = { type: "a2ui_operation" as const, runId: "run-1", sequence: 1, operation: { version: "v0.9", createSurface: { surfaceId: "s", catalogId: "catalog" } } };
    state = reduceChatStreamEvent(state, event);
    state = reduceChatStreamEvent(state, event);
    expect(state.operations).toHaveLength(1);
    expect(state.lastSequence).toBe(1);
  });

  test("records terminal completion and failure", () => {
    const completed = reduceChatStreamEvent(initialChatRunState("run-1"), { type: "run_completed", runId: "run-1", sequence: 1, completedAt: "2026-08-23T00:00:00.000Z", reply: "Done" });
    expect(completed.status).toBe("complete");
    expect(completed.text).toBe("Done");
    const failed = reduceChatStreamEvent(initialChatRunState("run-2"), { type: "run_failed", runId: "run-2", sequence: 1, failedAt: "2026-08-23T00:00:00.000Z", error: "provider unavailable", permanent: false });
    expect(failed.status).toBe("failed");
    expect(failed.error).toBe("provider unavailable");
  });
});
