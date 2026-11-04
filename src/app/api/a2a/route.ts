import { z } from "zod";
import { tenantHandler } from "@/lib/auth";
import { handleChat } from "@/lib/chatHandler";
import { getJob } from "@/lib/firestore";
import { campaignTask, rpcError, type CampaignView } from "@/lib/a2a";

const rpcSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).default({}),
});
const sendSchema = z.object({
  message: z.object({
    role: z.literal("user"),
    parts: z.array(z.object({ kind: z.literal("text"), text: z.string().min(1) }).passthrough()).min(1),
    messageId: z.string().min(1),
    contextId: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/).optional(),
  }).passthrough(),
}).passthrough();
const getSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/) }).passthrough();

async function post(req: Request) {
  const parsed = rpcSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json(rpcError(null, -32600, "invalid JSON-RPC request"));
  const { id, method, params } = parsed.data;
  if (method === "message/send") {
    const send = sendSchema.safeParse(params);
    if (!send.success) return Response.json(rpcError(id, -32602, "message/send needs one user message with text parts"));
    const contextId = send.data.message.contextId ?? "a2a";
    const text = send.data.message.parts.map((part) => part.text).join("\n").slice(0, 2000);
    const chat = await handleChat(new Request(req.url, {
      method: "POST",
      headers: { "content-type": "application/json", ...(req.headers.get("authorization") ? { authorization: req.headers.get("authorization")! } : {}), ...(req.headers.get("cookie") ? { cookie: req.headers.get("cookie")! } : {}) },
      body: JSON.stringify({ message: text, conversationId: `a2a-${contextId}` }),
    }));
    const body = await chat.json() as { reply?: string; job?: { id: string }; error?: string };
    if (!chat.ok) return Response.json(rpcError(id, -32603, body.error ?? "Harmonia could not take the request"));
    if (!body.job) {
      return Response.json({ jsonrpc: "2.0", id, result: { kind: "message", role: "agent", messageId: `${send.data.message.messageId}:reply`, contextId, parts: [{ kind: "text", text: body.reply ?? "" }] } });
    }
    const job = await getJob(body.job.id) as unknown as CampaignView;
    return Response.json({ jsonrpc: "2.0", id, result: campaignTask(job, contextId, body.reply) });
  }
  if (method === "tasks/get") {
    const get = getSchema.safeParse(params);
    if (!get.success) return Response.json(rpcError(id, -32602, "tasks/get needs a task id"));
    try {
      const job = await getJob(get.data.id) as unknown as CampaignView;
      return Response.json({ jsonrpc: "2.0", id, result: campaignTask(job, "a2a") });
    } catch {
      return Response.json(rpcError(id, -32001, "task not found"));
    }
  }
  return Response.json(rpcError(id, -32601, `method not supported: ${method}`));
}

export const POST = tenantHandler(post);
