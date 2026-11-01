import { describe, expect, it } from "vitest";

import { chatScopeKey, retentionPlan } from "@/lib/chatHistory";

describe("scoped chat history", () => {
  it("binds history to authenticated user, interface, and conversation", () => {
    expect(chatScopeKey("user-1", "dashboard", "conversation-1")).toBe("user-1:dashboard:conversation-1");
    expect(chatScopeKey("user-2", "dashboard", "conversation-1")).not.toBe(chatScopeKey("user-1", "dashboard", "conversation-1"));
    expect(() => chatScopeKey("user-1", "dashboard", "../escape")).toThrow("conversationId");
  });

  it("prunes oldest turns and produces metadata-only summary boundaries", () => {
    const messages = Array.from({ length: 5 }, (_, index) => ({
      id: `m-${index}`,
      at: `2026-08-25T00:0${index}:00.000Z`,
      data: index === 0 ? { jobId: "job-1", chatRunId: "run-1", transcript: "must not copy" } : undefined,
    }));
    const plan = retentionPlan(messages, 3);
    expect(plan.deleteIds).toEqual(["m-0", "m-1"]);
    expect(plan.summary).toEqual({
      fromAt: "2026-08-25T00:00:00.000Z",
      toAt: "2026-08-25T00:01:00.000Z",
      prunedMessageCount: 2,
      linkedJobIds: ["job-1"],
      linkedRunIds: ["run-1"],
    });
    expect(JSON.stringify(plan)).not.toContain("must not copy");
  });
});
