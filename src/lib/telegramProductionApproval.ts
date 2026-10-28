import { randomBytes } from "node:crypto";
import { createTelegramDecisionNonce, type TelegramDecisionNonceDoc } from "@/lib/firestore";
import { sendTelegramMessage } from "@/lib/telegramApi";

export async function sendTelegramProductionApproval(input: {
  connection: { botToken: string; chatId: string; routeTokenDigest: string };
  workspaceId: string;
  brandId: string;
  jobId: string;
  planId: string;
  planDigest: string;
  maximumCostUsd: string;
  expiresAt: string;
}, dependencies: {
  createNonce?: typeof createTelegramDecisionNonce;
  sendMessage?: typeof sendTelegramMessage;
  nonce?: () => string;
} = {}): Promise<void> {
  const nonce = (dependencies.nonce ?? (() => randomBytes(18).toString("base64url")))();
  const createNonce = dependencies.createNonce ?? createTelegramDecisionNonce;
  const sendMessage = dependencies.sendMessage ?? sendTelegramMessage;
  const record: TelegramDecisionNonceDoc = {
    routeTokenDigest: input.connection.routeTokenDigest,
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    jobId: input.jobId,
    actionId: input.planId,
    target: "production",
    payloadDigest: input.planDigest,
    decision: "approved",
    expiresAt: input.expiresAt,
    state: "pending",
  };
  await createNonce(record, nonce);
  await sendMessage({
    botToken: input.connection.botToken,
    chatId: input.connection.chatId,
    text: `Production plan approval required\nPlan: ${input.planId}\nMaximum cost: $${input.maximumCostUsd}\nDigest: ${input.planDigest}\nThis authorizes only the sealed paid media graph and does not authorize publication.`,
    replyMarkup: { inline_keyboard: [[{
      text: `Approve production · $${input.maximumCostUsd}`,
      callback_data: `harmonia:${nonce}`,
    }]] },
  });
}
