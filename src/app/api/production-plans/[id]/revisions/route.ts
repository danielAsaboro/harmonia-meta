import { z } from "zod";

import { operatorTenantHandler } from "@/lib/auth";
import { videoProductionPlanSchema } from "@/lib/mediaProduction";
import { productionPlanError } from "@/lib/productionPlanHttp";
import { proposeProductionPlan } from "@/lib/productionPlanStore";

const bodySchema = z.object({ plan: videoProductionPlanSchema }).strict();

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid production plan revision" }, { status: 400 });
  if (parsed.data.plan.id !== id) return Response.json({ error: "production plan path mismatch" }, { status: 409 });
  if (parsed.data.plan.revision < 2) return Response.json({ error: "revised production plan revision must exceed 1" }, { status: 409 });
  try {
    return Response.json({ plan: await proposeProductionPlan(parsed.data.plan) }, { status: 201 });
  } catch (error) {
    return productionPlanError(error);
  }
}

export const POST = operatorTenantHandler(post);
