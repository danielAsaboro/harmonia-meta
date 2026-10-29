import { eraseDueJobs } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";
import { z } from "zod";

const Body = z.object({ limit: z.number().int().min(1).max(100).default(20) }).strict();

async function post(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "invalid retention tick" }, { status: 400 });
  const erasedJobIds = await eraseDueJobs(new Date(), parsed.data.limit);
  return Response.json({ ok: true, erasedJobIds });
}

export const POST = internalTenantHandler(post);
