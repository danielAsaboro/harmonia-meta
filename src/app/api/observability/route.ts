import { tenantHandler } from "@/lib/auth";
import { parseObservabilityQuery } from "@/lib/observability/query";
import { listAgentActivity } from "@/lib/observability/repository";

async function get(req: Request) {
  try {
    const filters = parseObservabilityQuery(new URL(req.url));
    return Response.json(await listAgentActivity(filters));
  } catch (error) {
    const message = error instanceof Error && error.message === "invalid observability cursor"
      ? error.message
      : "invalid observability query";
    return Response.json({ error: message }, { status: 400 });
  }
}

export const GET = tenantHandler(get);
