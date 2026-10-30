import { listProposals } from "@/lib/firestore";
import { tenantHandler } from "@/lib/auth";

/** All proactive proposals (newest first) for the dashboard inbox. */
async function get(_req: Request) {
  return Response.json({ proposals: await listProposals() });
}

export const GET = tenantHandler(get);
