import { describe, expect, it } from "vitest";

import DashboardConversationPage from "../src/app/dashboard/[conversationId]/page";

describe("dashboard conversation route", () => {
  it("passes the canonical route identity into the chat console", async () => {
    const element = await DashboardConversationPage({
      params: Promise.resolve({ conversationId: "launch-123" }),
    });

    expect(element.props.conversationId).toBe("launch-123");
  });
});
