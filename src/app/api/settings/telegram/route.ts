import { z } from "zod";
import { randomBytes } from "node:crypto";
import {
  deleteTelegramConnection,
  getTelegramConnection,
  saveTelegramConnection,
} from "@/lib/firestore";
import { administratorTenantHandler } from "@/lib/auth";
import { telegramDigest } from "@/lib/telegramWebhook";
import { configureTelegramWebhook } from "@/lib/telegramApi";

const schema = z.object({
  botToken: z.string().min(20).max(256),
  chatId: z.string().regex(/^-?\d+$/),
});

async function get(_req: Request) {
  const connection = await getTelegramConnection();
  return Response.json({
    connected: Boolean(connection),
    chatId: connection?.chatId,
    connectedAt: connection?.connectedAt,
  });
}

async function put(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid Telegram connection" }, { status: 400 });
  const routeToken = randomBytes(24).toString("base64url");
  const webhookSecret = randomBytes(32).toString("base64url");
  const publicBaseUrl = process.env.PUBLIC_BASE_URL?.replace(/\/$/, "");
  if (!publicBaseUrl) return Response.json({ error: "PUBLIC_BASE_URL is required to configure Telegram" }, { status: 503 });
  await configureTelegramWebhook({
    botToken: parsed.data.botToken,
    webhookUrl: `${publicBaseUrl}/api/telegram/webhook/${routeToken}`,
    webhookSecret,
  });
  await saveTelegramConnection({
    ...parsed.data,
    connectedAt: new Date().toISOString(),
    routeTokenDigest: telegramDigest(routeToken),
    webhookSecretDigest: telegramDigest(webhookSecret),
    chatIdDigest: telegramDigest(parsed.data.chatId),
  });
  return Response.json({
    ok: true,
    webhookPath: `/api/telegram/webhook/${routeToken}`,
    configuredWithTelegram: true,
  });
}

async function del(_req: Request) {
  await deleteTelegramConnection();
  return Response.json({ ok: true });
}

export const GET = administratorTenantHandler(get);
export const PUT = administratorTenantHandler(put);
export const DELETE = administratorTenantHandler(del);
