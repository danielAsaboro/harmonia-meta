import { internalTenantHandler } from "@/lib/internalAuth";
import { dispatchProductionOutbox } from "@/lib/productionOutboxDispatcher";
import { z } from "zod";

const Body = z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict();

async function post(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "invalid production outbox tick" }, { status: 400 });
  return Response.json({ results: await dispatchProductionOutbox(parsed.data.limit) });
}

export const POST = internalTenantHandler(post);
