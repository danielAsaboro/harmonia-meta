import { getReplaySession } from "@/lib/recordReplay/sessionStore";
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = getReplaySession((await params).id); if (!session) return Response.json({ error: "replay session not found" }, { status: 404 });
  const body = await req.json().catch(() => null) as { action?: string; speed?: number } | null;
  try { if (body?.action === "start") void session.start(); else if (body?.action === "pause") session.dispatcher.pause(); else if (body?.action === "resume") session.dispatcher.resume(); else if (body?.action === "stop") session.dispatcher.stop(); else if (body?.action === "speed" && body.speed !== undefined) session.dispatcher.setSpeed(body.speed); else return Response.json({ error: "invalid replay control" }, { status: 400 }); return Response.json({ ...session.metadata, ...session.dispatcher.snapshot() }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "invalid replay control" }, { status: 400 }); }
}
