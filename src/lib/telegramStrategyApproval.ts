import { randomBytes } from "node:crypto";

import { createTelegramDecisionNonce, getTelegramConnection, saveTelegramStrategyPrompt } from "./firestore";
import { currentTenant } from "./tenancy";

const TELEGRAM_API = "https://api.telegram.org";

async function telegramCall(token: string, method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch(`${TELEGRAM_API}/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
  const payload = await response.json() as { ok?: boolean; description?: string; result?: Record<string, unknown> };
  if (!response.ok || !payload.ok) throw new Error(`Telegram ${method} failed: ${payload.description ?? response.status}`);
  return payload.result ?? {};
}

export async function sendTelegramStrategyApproval(jobId: string, title: string, payloadDigest: string, expiresAt: string): Promise<boolean> {
  const connection = await getTelegramConnection();
  if (!connection) return false;
  const tenant = currentTenant();
  const approveNonce = randomBytes(18).toString("base64url");
  const rejectNonce = randomBytes(18).toString("base64url");
  const base = {
    routeTokenDigest: connection.routeTokenDigest, workspaceId: tenant.workspaceId,
    brandId: tenant.brandId, jobId, actionId: "strategy", payloadDigest, expiresAt,
    state: "pending" as const,
  };
  await Promise.all([
    createTelegramDecisionNonce({ ...base, target: "strategy", decision: "approved" }, approveNonce),
    createTelegramDecisionNonce({ ...base, target: "strategy_feedback", decision: "rejected" }, rejectNonce),
  ]);
  await telegramCall(connection.botToken, "sendMessage", {
    chat_id: connection.chatId,
    text: `Ryan strategy approval required\n${title}\nDigest: ${payloadDigest}`,
    reply_markup: { inline_keyboard: [[
      { text: "Approve strategy", callback_data: `harmonia:${approveNonce}` },
      { text: "Reject with notes", callback_data: `harmonia:${rejectNonce}` },
    ]] },
  });
  return true;
}

export async function promptTelegramStrategyFeedback(input: {
  botToken: string; chatId: string; routeTokenDigest: string; workspaceId: string; brandId: string;
  jobId: string; payloadDigest: string; actorSubjectId: string; expiresAt: string;
}): Promise<number> {
  const result = await telegramCall(input.botToken, "sendMessage", {
    chat_id: input.chatId,
    text: "Reply to this message with the required strategy rejection notes.",
    reply_markup: { force_reply: true, selective: true },
  });
  const messageId = Number(result.message_id);
  if (!Number.isInteger(messageId)) throw new Error("Telegram feedback prompt returned no message id");
  await saveTelegramStrategyPrompt(input.routeTokenDigest, messageId, {
    routeTokenDigest: input.routeTokenDigest, workspaceId: input.workspaceId, brandId: input.brandId,
    jobId: input.jobId, payloadDigest: input.payloadDigest, actorSubjectId: input.actorSubjectId,
    expiresAt: input.expiresAt, state: "pending",
  });
  return messageId;
}
