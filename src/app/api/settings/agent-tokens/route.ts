import { z } from "zod";
import { administratorTenantHandler } from "@/lib/auth";
import { listAgentTokens, mintAgentToken } from "@/lib/agentTokens";
import { currentTenant } from "@/lib/tenancy";

const schema = z.object({ label: z.string().min(1).max(80) }).strict();

async function get(_req: Request) {
  const tokens = await listAgentTokens(currentTenant().workspaceId);
  return Response.json({ tokens: tokens.map(({ id, label, createdAt, revokedAt, lastUsedAt }) => ({ id, label, createdAt, revokedAt, lastUsedAt })) });
}

// The token is returned once; only its digest is stored.
async function post(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "a label is required" }, { status: 400 });
  const { token, record } = await mintAgentToken(currentTenant(), parsed.data.label);
  return Response.json({ token, id: record.id, label: record.label, createdAt: record.createdAt }, { status: 201 });
}

export const GET = administratorTenantHandler(get);
export const POST = administratorTenantHandler(post);
