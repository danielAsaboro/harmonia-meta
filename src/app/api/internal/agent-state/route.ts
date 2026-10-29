import { z } from "zod";
import {
  getAgentState,
  claimAgentTick,
  setAgentState,
} from "@/lib/firestore";
import { internalRoute } from "@/lib/internalHandler";
import { internalTenantHandler, isInternalAuthorized, unauthorized, withInternalTenant } from "@/lib/internalAuth";

/** Reads a proactive-check cadence marker. */
export async function GET(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  const key = new URL(req.url).searchParams.get("key") ?? "";
  if (!key) return Response.json({ error: "missing key" }, { status: 400 });
  return withInternalTenant(req, async () => Response.json({ state: await getAgentState(key) }));
}

const putSchema = z.object({
  key: z.string().min(1),
  // Worker emits ISO timestamps with a +00:00 offset.
  lastRunAt: z.string().datetime({ offset: true }).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

/** Records that a proactive check ran (worker cadence bookkeeping). */
export async function PUT(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, putSchema, async (body) => {
    const clean = Object.fromEntries(
      Object.entries({ lastRunAt: body.lastRunAt, data: body.data }).filter(([, v]) => v !== undefined),
    );
    await setAgentState(body.key, clean);
    return Response.json({ ok: true });
  });
}

const claimSchema = z.object({
  key: z.string().min(1).max(200),
  claimId: z.string().min(1).max(200),
  leaseSeconds: z.number().int().min(10).max(300),
}).strict();

async function post(req: Request) {
  const parsed = claimSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid tick claim" }, { status: 400 });
  const claimed = await claimAgentTick(parsed.data.key, parsed.data.claimId, parsed.data.leaseSeconds);
  return Response.json({ claimed });
}

export const POST = internalTenantHandler(post);
