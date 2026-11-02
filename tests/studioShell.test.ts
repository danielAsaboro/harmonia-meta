import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { clampConversationPercent, StudioShell } from "../src/components/studio/StudioShell";

describe("StudioShell", () => {
  it("renders the default desktop split as two fifths and three fifths", () => {
    const html = renderToStaticMarkup(createElement(StudioShell, {
      conversation: createElement("div", null, "Conversation"),
      canvas: createElement("div", null, "Canvas"),
      mobilePane: "conversation",
      onMobilePaneChange: () => {},
      canvasBadge: 1,
      approvalBadge: 2,
    }));
    expect(html).toContain("--studio-conversation:2fr");
    expect(html).toContain("--studio-canvas:3fr");
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="40"');
    expect(html).toContain('aria-label="1 generated workspace active, 2 approvals pending"');
    expect(html).not.toContain('aria-label="Harmonia home"');
  });

  it("clamps resized conversation widths", () => {
    expect(clampConversationPercent(20)).toBe(32);
    expect(clampConversationPercent(44)).toBe(44);
    expect(clampConversationPercent(80)).toBe(52);
  });
});
