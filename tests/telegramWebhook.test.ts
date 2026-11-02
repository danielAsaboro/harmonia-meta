import { describe, expect, it } from "vitest";

import {
  TelegramWebhookError,
  callbackNonce,
  decideTelegramNonceClaim,
  verifyTelegramWebhook,
} from "@/lib/telegramWebhook";

const route = {
  routeTokenDigest: "f".repeat(64),
  webhookSecretDigest: "a".repeat(64),
  chatIdDigest: "b".repeat(64),
  workspaceId: "workspace-1",
  brandId: "brand-1",
};

const update = {
  update_id: 10,
  callback_query: {
    id: "callback-1",
    from: { id: 42 },
    message: { chat: { id: -1001 } },
    data: "harmonia:nonce_abcdefghijklmnopqrstuvwxyz012345",
  },
};

describe("Telegram webhook authority", () => {
  it.each([
    { update_id: 20, message: { message_id: 92, date: 1788390000, from: { id: 42, is_bot: false, first_name: "Operator" }, chat: { id: -1001, type: "supergroup", title: "Harmonia" }, text: "status job-1" } },
    { update_id: 21, callback_query: { ...update.callback_query, from: { id: 42, is_bot: false, first_name: "Operator" }, chat_instance: "123456", message: { message_id: 93, date: 1788390000, chat: { id: -1001, type: "supergroup" }, text: "Review this action" } } },
  ])("accepts documented Telegram metadata without treating it as authority", (payload) => {
    const verified = verifyTelegramWebhook({
      route, routeToken: "route-token", secret: "correct", update: payload,
      digest: (value) => value === "route-token" ? route.routeTokenDigest : value === "correct" ? route.webhookSecretDigest : value === "-1001" ? route.chatIdDigest : "c".repeat(64),
    });
    expect(verified.principal.subjectId).toBe(`telegram_${"c".repeat(24)}`);
    expect(verified.kind).toBe("callback_query" in payload ? "callback" : "operator_message");
  });
  it("rejects a structurally valid callback when the webhook secret is wrong", () => {
    expect(() => verifyTelegramWebhook({
      route: { ...route, webhookSecretDigest: route.webhookSecretDigest },
      routeToken: "route-token",
      secret: "wrong",
      update,
      digest: (value) => value === "route-token" ? route.routeTokenDigest : value === "correct" ? route.webhookSecretDigest : value === "-1001" ? route.chatIdDigest : "0".repeat(64),
    })).toThrowError(new TelegramWebhookError("invalid Telegram webhook secret", 401));
  });

  it("derives a Telegram principal from the callback sender and allow-listed chat", () => {
    const verified = verifyTelegramWebhook({
      route,
      routeToken: "route-token",
      secret: "correct",
      update,
      digest: (value) => value === "route-token" ? route.routeTokenDigest : value === "correct" ? route.webhookSecretDigest : value === "-1001" ? route.chatIdDigest : "c".repeat(64),
    });
    expect(verified.principal).toMatchObject({
      kind: "telegram_user",
      subjectId: `telegram_${"c".repeat(24)}`,
    });
    expect(verified.kind).toBe("callback");
    if (verified.kind !== "callback") throw new Error("expected callback");
    expect(verified.nonce).toBe(callbackNonce(update.callback_query.data));
  });

  it("authenticates bounded strategy rejection feedback replies", () => {
    const verified = verifyTelegramWebhook({
      route, routeToken: "route-token", secret: "correct",
      update: { update_id: 11, message: { message_id: 91, from: { id: 42 }, chat: { id: -1001 }, text: "Narrow the audience", reply_to_message: { message_id: 90 } } },
      digest: (value) => value === "route-token" ? route.routeTokenDigest : value === "correct" ? route.webhookSecretDigest : value === "-1001" ? route.chatIdDigest : "c".repeat(64),
    });
    expect(verified).toMatchObject({ kind: "strategy_feedback", promptMessageId: 90, feedback: "Narrow the audience" });
  });

  it("authenticates ordinary allow-listed operator messages", () => {
    const verified = verifyTelegramWebhook({
      route, routeToken: "route-token", secret: "correct",
      update: { update_id: 12, message: { message_id: 92, from: { id: 42 }, chat: { id: -1001 }, text: "status job-1" } },
      digest: (value) => value === "route-token" ? route.routeTokenDigest : value === "correct" ? route.webhookSecretDigest : value === "-1001" ? route.chatIdDigest : "c".repeat(64),
    });
    expect(verified).toMatchObject({ kind: "operator_message", message: "status job-1", messageId: 92 });
  });

  it("strictly rejects extra callback fields", () => {
    expect(() => verifyTelegramWebhook({
      route,
      routeToken: "route-token",
      secret: "correct",
      update: { ...update, callback_query: { ...update.callback_query, game_short_name: "unexpected" } },
      digest: (value) => value === "route-token" ? route.routeTokenDigest : value === "correct" ? route.webhookSecretDigest : value === "-1001" ? route.chatIdDigest : "c".repeat(64),
    })).toThrow("invalid Telegram update");
  });

  it("returns the original decision for an already-consumed callback", () => {
    expect(decideTelegramNonceClaim({
      state: "consumed",
      expiresAt: "2026-08-27T00:00:00.000Z",
      decisionId: "job-1:approval:action-1",
    }, new Date("2026-08-26T00:00:00.000Z"))).toEqual({
      outcome: "duplicate",
      decisionId: "job-1:approval:action-1",
    });
  });
});
