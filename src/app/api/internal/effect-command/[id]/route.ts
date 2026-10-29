import { getCommand } from "@/lib/effectCommandStore";
import { internalTenantHandler } from "@/lib/internalAuth";

async function get(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const command = await getCommand(id);
  if (!command) return Response.json({ error: "effect command not found" }, { status: 404 });
  return Response.json({ command });
}

export const GET = internalTenantHandler(get);
