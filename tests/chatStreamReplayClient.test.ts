import { describe, expect, it, vi } from "vitest";
import { replayChatRunUntilTerminal } from "../src/hooks/useHarmoniaChat";
import type { ChatStreamEvent } from "../src/lib/a2ui/contracts";

describe("chat stream reconnect client", () => {
  it("polls durable events until a terminal event arrives", async () => {
    const responses = [
      { events: [{ type: "activity", runId: "run-1", sequence: 2, activity: { id: "maya", label: "compose", status: "active" } }] },
      { events: [] },
      { events: [{ type: "run_completed", runId: "run-1", sequence: 3, completedAt: "2026-08-23T00:00:00.000Z", reply: "Done" }] },
    ];
    const request = vi.fn().mockImplementation(async () => new Response(JSON.stringify(responses.shift()), { status: 200 }));
    const events: ChatStreamEvent[] = [];

    await replayChatRunUntilTerminal({
      runId: "run-1",
      afterSequence: 1,
      onEvent: (event) => events.push(event),
      request,
      wait: async () => {},
      maxAttempts: 4,
    });

    expect(request).toHaveBeenCalledTimes(3);
    expect(events.map((event) => event.sequence)).toEqual([2, 3]);
  });

  it("rejects a noncontiguous durable replay", async () => {
    await expect(replayChatRunUntilTerminal({
      runId: "run-1",
      afterSequence: 1,
      onEvent: () => {},
      request: async () => new Response(JSON.stringify({ events: [{ type: "run_completed", runId: "run-1", sequence: 3, completedAt: "2026-08-23T00:00:00.000Z", reply: "Done" }] })),
      wait: async () => {},
      maxAttempts: 1,
    })).rejects.toThrow("noncontiguous");
  });
});
