import { getReplaySession } from "@/lib/recordReplay/sessionStore";
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = getReplaySession((await params).id); if (!session) return Response.json({ error: "replay session not found" }, { status: 404 });
  const after = Number(new URL(req.url).searchParams.get("after") ?? -1); if (!Number.isInteger(after) || after < -1) return Response.json({ error: "invalid sequence cursor" }, { status: 400 });
  return Response.json({ ...session.metadata, ...session.dispatcher.snapshot(), events: session.eventsAfter(after) });
}
