import { administratorTenantHandler } from "@/lib/auth";
import { revokeAgentToken } from "@/lib/agentTokens";
import { currentTenant } from "@/lib/tenancy";

async function remove(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const revoked = await revokeAgentToken(currentTenant().workspaceId, id);
  return revoked ? new Response(null, { status: 204 }) : Response.json({ error: "token not found" }, { status: 404 });
}

export const DELETE = administratorTenantHandler(remove);
