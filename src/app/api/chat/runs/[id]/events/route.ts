import { tenantHandler } from "@/lib/auth";
import { listChatRunEvents } from "@/lib/chatRuns";

async function get(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const rawAfter = new URL(req.url).searchParams.get("after") ?? "-1";
  const after = Number(rawAfter);
  if (!Number.isInteger(after) || after < -1) return Response.json({ error: "invalid event offset" }, { status: 400 });
  try {
    return Response.json({ events: await listChatRunEvents(id, after) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}

export const GET = tenantHandler(get);
