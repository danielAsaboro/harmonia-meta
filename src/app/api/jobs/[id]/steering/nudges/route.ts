import { operatorTenantHandler } from "@/lib/auth";
import { proposeNudge } from "@/lib/steering/repository";
import { nudgeScopeSchema } from "@/lib/steering/contracts";
import { z } from "zod";
const schema = z.object({ scope: nudgeScopeSchema, contentItemId: z.string().min(1).optional(), instruction: z.string().min(3).max(2000) }).strict();
async function post(request: Request, { params }: { params: Promise<{ id: string }> }) { const parsed = schema.safeParse(await request.json().catch(() => null)); if (!parsed.success) return Response.json({ error: "invalid nudge", detail: parsed.error.flatten() }, { status: 400 }); try { return Response.json(await proposeNudge((await params).id, parsed.data), { status: 201 }); } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "nudge rejected" }, { status: 409 }); } }
export const POST = operatorTenantHandler(post);
