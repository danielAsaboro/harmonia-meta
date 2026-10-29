import { operatorTenantHandler } from "@/lib/auth";
import { applyNudge } from "@/lib/steering/repository";
import { dispatchStageOutboxRecord } from "@/lib/stageOutboxDispatcher";
import { z } from "zod";
const schema = z.object({ impactDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
async function post(request: Request, { params }: { params: Promise<{ id: string; nudgeId: string }> }) { const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: "exact impact digest required" }, { status: 400 }); const { id, nudgeId } = await params; try { const result = await applyNudge(id, nudgeId, parsed.data.impactDigest); await dispatchStageOutboxRecord(result.outboxId).catch(() => undefined); return Response.json(result); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "nudge could not apply" }, { status: 409 }); } }
export const POST = operatorTenantHandler(post);
