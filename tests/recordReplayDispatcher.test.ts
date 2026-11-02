import { describe, expect, it, vi } from "vitest";
import { ReplayDispatcher } from "@/lib/recordReplay/dispatcher";
import { importReplayBundle } from "@/lib/recordReplay/importer";
import { replayTestBundle } from "./recordReplayImporter.test";

describe("replay dispatcher", () => {
  it("supports cursor reconnect and deterministic completion", async () => {
    const imported = importReplayBundle(JSON.stringify(replayTestBundle()), { destination: "private" });
    const dispatcher = new ReplayDispatcher(imported); expect(dispatcher.eventsAfter(-1)).toHaveLength(1);
    await dispatcher.start({ immediate: true }); expect(dispatcher.snapshot()).toMatchObject({ status: "complete", lastSequence: 0 });
  });
  it("pauses and resumes timed playback", async () => {
    vi.useFakeTimers(); const imported = importReplayBundle(JSON.stringify(replayTestBundle()), { destination: "private" }); const seen: number[] = [];
    const dispatcher = new ReplayDispatcher(imported, (event) => seen.push(event.sequence)); dispatcher.pause(); const running = dispatcher.start(); await vi.advanceTimersByTimeAsync(2000); expect(seen).toEqual([]);
    dispatcher.resume(); await vi.runAllTimersAsync(); await running; expect(seen).toEqual([0]); vi.useRealTimers();
  });
});
