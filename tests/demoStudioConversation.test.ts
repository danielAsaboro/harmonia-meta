import { describe, expect, it } from "vitest";
import { buildDemoStudioConversation } from "../scripts/demo-studio-conversation.mjs";

describe("studio demo conversation", () => {
  it("builds a clearly labelled cross-media local conversation", () => {
    const messages = buildDemoStudioConversation({ runId: "demo-a2ui-multimodal" });
    expect(messages.length).toBeGreaterThanOrEqual(24);
    expect(messages.filter((message: { role: string }) => message.role === "user").length).toBeGreaterThanOrEqual(12);
    expect(messages.some((message: { data?: { intent?: string } }) => message.data?.intent === "create_job")).toBe(true);
    expect(messages.some((message: { data?: { intent?: string } }) => message.data?.intent === "list_artifacts")).toBe(true);
    expect(messages.some((message: { data?: { pendingActions?: unknown[] } }) => message.data?.pendingActions?.length)).toBe(true);
    expect(JSON.stringify(messages)).toContain("Local demo fixture");
    expect(JSON.stringify(messages)).not.toContain("Veo generated successfully");
  });
});
