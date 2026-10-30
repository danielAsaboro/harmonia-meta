import { createReplaySession } from "@/lib/recordReplay/sessionStore";
function enabled() { return process.env.NODE_ENV !== "production" || process.env.HARMONIA_REPLAY_ENABLED === "1"; }
export async function POST(req: Request) {
  if (!enabled()) return Response.json({ error: "replay is disabled" }, { status: 404 });
  const raw = await req.text(); if (raw.length > 5_000_000) return Response.json({ error: "bundle exceeds replay import limit" }, { status: 413 });
  try { const session = createReplaySession(raw); return Response.json({ id: session.id, ...session.metadata, ...session.dispatcher.snapshot() }, { status: 201 }); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "invalid replay bundle" }, { status: 400 }); }
}
