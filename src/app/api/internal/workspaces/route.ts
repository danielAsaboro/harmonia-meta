import { listWorkspaceScopes } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";

export async function GET(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return Response.json({ workspaces: await listWorkspaceScopes() });
}
