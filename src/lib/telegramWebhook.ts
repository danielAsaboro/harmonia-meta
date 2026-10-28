import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";

import { telegramPrincipal, type Principal } from "./authority";

export interface TelegramWebhookRoute {
  routeTokenDigest: string;
  webhookSecretDigest: string;
  chatIdDigest: string;
  workspaceId: string;
  brandId: string;
}

const callbackData = z.string().regex(/^harmonia:[A-Za-z0-9_-]{24,48}$/).max(64);
const callbackUpdate = z.object({
  update_id: z.number().int().nonnegative(),
  callback_query: z.object({
    id: z.string().min(1).max(256),
    from: z.object({ id: z.number().int() }),
    message: z.object({
      chat: z.object({ id: z.number().int() }),
    }),
    data: callbackData,
    game_short_name: z.never().optional(),
  }),
}).strict();
const feedbackUpdate = z.object({
  update_id: z.number().int().nonnegative(),
  message: z.object({
    message_id: z.number().int().positive(), from: z.object({ id: z.number().int() }),
    chat: z.object({ id: z.number().int() }), text: z.string().min(1).max(2000),
    reply_to_message: z.object({ message_id: z.number().int().positive() }).passthrough(),
  }),
}).strict();
const operatorMessageUpdate = z.object({
  update_id: z.number().int().nonnegative(),
  message: z.object({
    message_id: z.number().int().positive(), from: z.object({ id: z.number().int() }),
    chat: z.object({ id: z.number().int() }), text: z.string().min(1).max(2000),
    reply_to_message: z.never().optional(),
  }),
}).strict();
export const telegramUpdateSchema = z.union([callbackUpdate, feedbackUpdate, operatorMessageUpdate]);

export class TelegramWebhookError extends Error {
  constructor(message: string, readonly status: 400 | 401 | 403 | 404 | 409 | 413) {
    super(message);
  }
}

export function telegramDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function equalDigest(actual: string, expected: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(actual) || !/^[a-f0-9]{64}$/.test(expected)) return false;
  return timingSafeEqual(Buffer.from(actual, "hex"), Buffer.from(expected, "hex"));
}

export function callbackNonce(data: string): string {
  const parsed = callbackData.safeParse(data);
  if (!parsed.success) throw new TelegramWebhookError("invalid Telegram callback data", 400);
  return parsed.data.slice("harmonia:".length);
}

export function decideTelegramNonceClaim(
  value: { state: "pending" | "processing" | "consumed"; expiresAt: string; claimedAt?: string; decisionId?: string },
  now = new Date(),
): { outcome: "claim" } | { outcome: "duplicate"; decisionId: string } {
  if (Date.parse(value.expiresAt) <= now.getTime()) {
    throw new TelegramWebhookError("Telegram decision nonce expired", 409);
  }
  if (value.state === "consumed") {
    if (!value.decisionId) throw new TelegramWebhookError("consumed Telegram nonce has no decision", 409);
    return { outcome: "duplicate", decisionId: value.decisionId };
  }
  if (value.state === "processing" && value.claimedAt && now.getTime() - Date.parse(value.claimedAt) < 60_000) {
    throw new TelegramWebhookError("Telegram decision nonce is already processing", 409);
  }
  return { outcome: "claim" };
}

export function verifyTelegramWebhook(input: {
  route: TelegramWebhookRoute;
  routeToken: string;
  secret: string;
  update: unknown;
  digest?: (value: string) => string;
}): {
  kind: "callback";
  principal: Extract<Principal, { kind: "telegram_user" }>;
  nonce: string;
  updateId: number;
} | {
  kind: "strategy_feedback";
  principal: Extract<Principal, { kind: "telegram_user" }>;
  promptMessageId: number; feedback: string; updateId: number;
} | {
  kind: "operator_message";
  principal: Extract<Principal, { kind: "telegram_user" }>;
  messageId: number; message: string; updateId: number;
} {
  const digest = input.digest ?? telegramDigest;
  if (!equalDigest(digest(input.routeToken), input.route.routeTokenDigest)) {
    throw new TelegramWebhookError("Telegram webhook route not found", 404);
  }
  if (!equalDigest(digest(input.secret), input.route.webhookSecretDigest)) {
    throw new TelegramWebhookError("invalid Telegram webhook secret", 401);
  }
  const parsed = telegramUpdateSchema.safeParse(input.update);
  if (!parsed.success) throw new TelegramWebhookError("invalid Telegram update", 400);
  const callback = "callback_query" in parsed.data ? parsed.data.callback_query : null;
  const message = "message" in parsed.data ? parsed.data.message : null;
  const chatIdDigest = digest(String(callback ? callback.message.chat.id : message!.chat.id));
  if (!equalDigest(chatIdDigest, input.route.chatIdDigest)) {
    throw new TelegramWebhookError("Telegram chat is not allowed", 403);
  }
  const senderDigest = digest(String(callback ? callback.from.id : message!.from.id));
  const principal = telegramPrincipal({
    subjectId: `telegram_${senderDigest.slice(0, 24)}`,
    authenticationId: `telegram_update_${parsed.data.update_id}`,
    chatIdDigest,
    callbackQueryIdDigest: callback ? digest(callback.id) : digest(`message:${message!.message_id}`),
  });
  if (message) {
    if ("reply_to_message" in message) {
      const replyTo = message.reply_to_message as { message_id: number };
      return {
        kind: "strategy_feedback", principal, promptMessageId: replyTo.message_id,
        feedback: message.text.trim(), updateId: parsed.data.update_id,
      };
    }
    return {
      kind: "operator_message", principal, messageId: message.message_id,
      message: message.text.trim(), updateId: parsed.data.update_id,
    };
  }
  return {
    kind: "callback",
    principal,
    nonce: callbackNonce(callback!.data),
    updateId: parsed.data.update_id,
  };
}
