import { listAllChatMessages, listChatMessages } from "@/lib/firestore";
import { tenantHandler } from "@/lib/auth";
import type { ChatSurface } from "@/lib/chatHistory";

/** Past operator-chat messages (dashboard + telegram), oldest first. */
async function get(req: Request) {
  const limitParam = Number(new URL(req.url).searchParams.get("limit") ?? "100");
  const params = new URL(req.url).searchParams;
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 300) : 100;
  const surface = params.get("surface") ?? "dashboard";
  const includeAllConversations = params.get("all") === "1";
  const conversationId = params.get("conversationId") ?? "primary";
  if ((surface !== "dashboard" && surface !== "telegram") || !/^[A-Za-z0-9_-]{1,128}$/.test(conversationId)) {
    return Response.json({ error: "invalid history scope" }, { status: 400 });
  }
  return Response.json({ messages: includeAllConversations
    ? await listAllChatMessages(limit, surface as ChatSurface)
    : await listChatMessages(limit, surface as ChatSurface, conversationId) });
}

export const GET = tenantHandler(get);
