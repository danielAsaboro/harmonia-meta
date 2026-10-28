type TelegramRequest = typeof fetch;

const TELEGRAM_API = "https://api.telegram.org";

async function callTelegram(
  botToken: string,
  method: string,
  body: Record<string, unknown>,
  request: TelegramRequest,
): Promise<Record<string, unknown>> {
  const response = await request(`${TELEGRAM_API}/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const payload = await response.json().catch(() => null) as { ok?: boolean; description?: string; result?: unknown } | null;
  if (!response.ok || !payload?.ok) {
    throw new Error(`Telegram ${method} failed: ${payload?.description ?? response.status}`);
  }
  return payload as Record<string, unknown>;
}

export async function configureTelegramWebhook(input: {
  botToken: string;
  webhookUrl: string;
  webhookSecret: string;
  request?: TelegramRequest;
}): Promise<void> {
  await callTelegram(input.botToken, "setWebhook", {
    url: input.webhookUrl,
    secret_token: input.webhookSecret,
    allowed_updates: ["message", "callback_query"],
  }, input.request ?? fetch);
}

export async function sendTelegramMessage(input: {
  botToken: string;
  chatId: string;
  text: string;
  replyMarkup?: Record<string, unknown>;
  request?: TelegramRequest;
}): Promise<void> {
  await callTelegram(input.botToken, "sendMessage", {
    chat_id: input.chatId,
    text: input.text.slice(0, 4096),
    ...(input.replyMarkup ? { reply_markup: input.replyMarkup } : {}),
  }, input.request ?? fetch);
}
