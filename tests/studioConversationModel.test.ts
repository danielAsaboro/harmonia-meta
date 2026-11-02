import { describe, expect, it } from "vitest";
import {
  activeJobIdForConversation,
  buildStudioChapters,
  referencedJobIds,
} from "../src/lib/studio/conversationModel";

describe("studio conversation model", () => {
  it("groups complete exchanges without dropping operator messages", () => {
    const messages = [
      { role: "user" as const, text: "What is trending?", at: "2026-08-23T08:00:00.000Z" },
      { role: "assistant" as const, text: "Two signals are relevant.", data: { intent: "status", reply: "" }, at: "2026-08-23T08:00:01.000Z" },
      { role: "user" as const, text: "Draft the founder take.", at: "2026-08-23T08:01:00.000Z" },
      { role: "assistant" as const, text: "One reviewed artifact.", data: { intent: "list_artifacts", reply: "", jobId: "job-1", artifacts: [] }, at: "2026-08-23T08:01:01.000Z" },
      { role: "user" as const, text: "Approve it.", at: "2026-08-23T08:02:00.000Z" },
      { role: "assistant" as const, text: "Approval recorded.", data: { intent: "approve", reply: "", jobId: "job-1" }, at: "2026-08-23T08:02:01.000Z" },
    ];
    const chapters = buildStudioChapters(messages);
    expect(chapters.map(({ key, messages: chapterMessages }) => [key, chapterMessages.length])).toEqual([
      ["discovery", 2],
      ["narrative", 2],
      ["approval", 2],
    ]);
    expect(chapters.flatMap((chapter) => chapter.messages)).toHaveLength(6);
  });

  it("selects the latest persisted job reference", () => {
    const messages = [
      { role: "assistant" as const, text: "old", data: { intent: "status", reply: "", jobId: "job-old" } },
      { role: "assistant" as const, text: "new", data: { intent: "create_job", reply: "", job: { id: "job-new", stage: "draft" as const, status: "running" } } },
    ];
    expect(activeJobIdForConversation(messages)).toBe("job-new");
    expect(referencedJobIds(messages)).toEqual(["job-old", "job-new"]);
  });
});
