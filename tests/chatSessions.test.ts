import { describe, expect, it } from "vitest";
import { conversationPath, groupSessions } from "../src/lib/chatSessions";

describe("chat sessions", () => {
  it("keeps stable message IDs and run state inside grouped sessions", () => {
    const run = { runId: "r1", status: "complete" as const, lastSequence: 1, text: "Done", activities: [], tools: [], operations: [], confirmations: [], jobUpdates: [] };
    const sessions = groupSessions([
      { id: "m1", role: "user", text: "Create launch content", surface: "dashboard", at: "2026-08-23T08:00:00.000Z" },
      { id: "m2", role: "assistant", text: "Created", surface: "dashboard", at: "2026-08-23T08:00:01.000Z", run, data: { intent: "create_job", reply: "", jobId: "job-1" } },
    ]);
    expect(sessions[0].messages.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(sessions[0].messages[1].run?.runId).toBe("r1");
  });

  it("keeps a rights confirmation in the same conversation", () => {
    const sessions = groupSessions([
      { id: "m1", role: "user", text: "Turn this video into launch content", surface: "dashboard", at: "2026-09-04T04:07:00.000Z" },
      { id: "m2", role: "assistant", text: "Confirm source rights", surface: "dashboard", at: "2026-09-04T04:07:01.000Z" },
      { id: "m3", role: "user", text: "I confirm I have rights to use this source", surface: "dashboard", at: "2026-09-04T04:07:10.000Z" },
      { id: "m4", role: "assistant", text: "Starting the job", surface: "dashboard", at: "2026-09-04T04:07:11.000Z" },
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].messages.map((message) => message.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("keeps an explicit conversation together across long pauses", () => {
    const sessions = groupSessions([
      { id: "m1", conversationId: "launch-1", role: "user", text: "Start", surface: "dashboard", at: "2026-09-04T04:00:00.000Z" },
      { id: "m2", conversationId: "launch-1", role: "assistant", text: "Continued", surface: "dashboard", at: "2026-09-04T08:00:00.000Z" },
    ]);

    expect(sessions).toHaveLength(1);
    expect(sessions[0].conversationId).toBe("launch-1");
  });

  it("builds a canonical dashboard URL only for valid conversation identifiers", () => {
    expect(conversationPath("launch_2026-09-04")).toBe("/dashboard/launch_2026-09-04");
    expect(() => conversationPath("bad/id")).toThrow("invalid conversation id");
  });
});
