import { agentActivitySchema } from "@/lib/observability/schema";
import { getDurableRuntimeSnapshot, writeAgentActivity } from "@/lib/observability/repository";
import { internalTenantHandler, isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, agentActivitySchema, async (body) => {
    const result = await writeAgentActivity(body);
    return Response.json(result, { status: 201 });
  });
}

export const GET = internalTenantHandler(async () => Response.json({ runtime: await getDurableRuntimeSnapshot() }));
