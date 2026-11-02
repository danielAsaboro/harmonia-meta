import { describe, expect, it, vi } from "vitest";
import { sendTelegramProductionApproval } from "@/lib/telegramProductionApproval";

describe("Telegram production approval", () => {
  it("persists a one-time digest-bound nonce before sending the inline control", async () => {
    const createNonce = vi.fn().mockResolvedValue(undefined);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    await sendTelegramProductionApproval({
      connection: { botToken: "bot-token", chatId: "42", routeTokenDigest: "route-digest" },
      workspaceId: "workspace-1", brandId: "brand-1", jobId: "job-1", planId: "plan-1",
      planDigest: "a".repeat(64), maximumCostUsd: "0.400000", expiresAt: "2026-09-01T00:00:00.000Z",
    }, { createNonce, sendMessage, nonce: () => "nonce-production-123456789" });
    expect(createNonce).toHaveBeenCalledWith(expect.objectContaining({
      target: "production", decision: "approved", jobId: "job-1", actionId: "plan-1",
      payloadDigest: "a".repeat(64), state: "pending",
    }), "nonce-production-123456789");
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      botToken: "bot-token", chatId: "42", text: expect.stringContaining("does not authorize publication"),
      replyMarkup: { inline_keyboard: [[{
        text: "Approve production · $0.400000",
        callback_data: "harmonia:nonce-production-123456789",
      }]] },
    }));
  });
});
