import { z } from "zod";
import { strategyContextSchema } from "@/lib/contracts";
import { getGoals, saveGoals } from "@/lib/firestore";
import { administratorTenantHandler } from "@/lib/auth";

const goalsSchema = z.object({
  weeklyPostTarget: z.number().int().min(1).max(50).optional(),
  audience: z.string().max(300).optional(),
  voice: z.string().max(300).optional(),
  topics: z.array(z.string().min(1).max(120)).max(10).default([]),
  strategyContext: strategyContextSchema.optional(),
});

async function get(_req: Request) {
  return Response.json({ goals: await getGoals() });
}

/** Operator-token gated so random visitors cannot rewrite strategy. */
async function put(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = goalsSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid goals", detail: parsed.error.flatten() }, { status: 400 });
  }
  const current = await getGoals();
  const merged = { ...current, ...parsed.data };
  await saveGoals(merged);
  return Response.json({ ok: true, goals: merged });
}

export const GET = administratorTenantHandler(get);
export const PUT = administratorTenantHandler(put);
