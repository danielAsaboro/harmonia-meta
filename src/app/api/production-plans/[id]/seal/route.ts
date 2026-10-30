import { z } from "zod";

import { operatorTenantHandler } from "@/lib/auth";
import { productionPlanError } from "@/lib/productionPlanHttp";
import { sealProductionPlan } from "@/lib/productionPlanStore";

const bodySchema = z.object({ planDigest: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid production plan seal" }, { status: 400 });
  try {
    return Response.json({ plan: await sealProductionPlan(id, parsed.data) });
  } catch (error) {
    return productionPlanError(error);
  }
}

export const POST = operatorTenantHandler(post);
