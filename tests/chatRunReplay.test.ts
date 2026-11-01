import { describe, expect, it } from "vitest";
import { replayChatRunEvents } from "../src/lib/a2ui/chatReducer";

describe("replayChatRunEvents", () => {
  it("reconstructs persisted UI state through the validated stream reducer", () => {
    const state = replayChatRunEvents("demo-run", [
      { type: "run_started", runId: "demo-run", sequence: 0, startedAt: "2026-08-23T08:00:00.000Z" },
      { type: "activity", runId: "demo-run", sequence: 1, activity: { id: "analyst", label: "Analyze source", status: "complete" } },
      { type: "tool_activity", runId: "demo-run", sequence: 2, tool: { name: "video_understanding", status: "complete", traceId: "trace-demo" } },
      { type: "a2ui_operation", runId: "demo-run", sequence: 3, operation: { version: "v0.9", createSurface: { surfaceId: "chat-demo-run", catalogId: "https://harmonia.app/a2ui/catalogs/chat/v1" } } },
      { type: "confirmation_requested", runId: "demo-run", sequence: 4, confirmation: { id: "approve-launch", jobId: "demo-launch", actionId: "act-pub-launch", title: "Publish launch post", risk: "high", state: "pending" } },
      { type: "run_completed", runId: "demo-run", sequence: 5, completedAt: "2026-08-23T08:00:05.000Z", reply: "Ready for review." },
    ]);

    expect(state).toMatchObject({
      runId: "demo-run",
      status: "complete",
      lastSequence: 5,
      text: "Ready for review.",
    });
    expect(state.activities).toHaveLength(1);
    expect(state.tools).toHaveLength(1);
    expect(state.operations).toHaveLength(1);
    expect(state.confirmations).toHaveLength(1);
  });

  it("rejects malformed or cross-run persisted events", () => {
    expect(() => replayChatRunEvents("demo-run", [
      { type: "activity", runId: "another-run", sequence: 0, activity: { id: "analyst", label: "Analyze source", status: "complete" } },
    ])).toThrow(/another-run/);

    expect(() => replayChatRunEvents("demo-run", [
      { type: "activity", runId: "demo-run", sequence: 0, activity: { id: "analyst", label: "Analyze source", status: "unknown" } },
    ])).toThrow();
  });

  it("preserves exact generated slot revisions in persisted order", () => {
    const operations = [
      { version: "v0.9", createSurface: { surfaceId: "studio-demo-run-canvas-r1", catalogId: "https://harmonia.app/a2ui/catalogs/chat/v1" } },
      { version: "v0.9", updateComponents: { surfaceId: "studio-demo-run-canvas-r1", components: [{ id: "root", component: "Column", children: [] }] } },
      { version: "v0.9", createSurface: { surfaceId: "studio-demo-run-conversation-r1", catalogId: "https://harmonia.app/a2ui/catalogs/chat/v1" } },
      { version: "v0.9", createSurface: { surfaceId: "studio-demo-run-approval-r2", catalogId: "https://harmonia.app/a2ui/catalogs/chat/v1" } },
    ];
    const events = [
      { type: "run_started", runId: "demo-run", sequence: 0, startedAt: "2026-08-23T08:00:00.000Z" },
      ...operations.map((operation, index) => ({ type: "a2ui_operation", runId: "demo-run", sequence: index + 1, operation })),
      { type: "run_completed", runId: "demo-run", sequence: operations.length + 1, completedAt: "2026-08-23T08:00:05.000Z", reply: "Ready." },
    ];
    expect(replayChatRunEvents("demo-run", events).operations).toEqual(operations);
  });

  it("rejects duplicate durable event sequences", () => {
    expect(() => replayChatRunEvents("demo-run", [
      { type: "run_started", runId: "demo-run", sequence: 0, startedAt: "2026-08-23T08:00:00.000Z" },
      { type: "text_delta", runId: "demo-run", sequence: 0, delta: "duplicate" },
    ])).toThrow("sequence");
  });
});
