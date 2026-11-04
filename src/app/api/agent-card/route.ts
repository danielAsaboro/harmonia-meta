import { agentCard } from "@/lib/a2a";

// Served at /.well-known/agent-card.json (see next.config.ts rewrites).
export function GET(req: Request) {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  return Response.json(agentCard(base.replace(/\/$/, "")));
}
