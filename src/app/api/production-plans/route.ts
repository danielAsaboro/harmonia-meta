import { z } from "zod";

import { operatorTenantHandler } from "@/lib/auth";
import { videoProductionPlanSchema } from "@/lib/mediaProduction";
import { productionPlanError } from "@/lib/productionPlanHttp";
import { proposeProductionPlan } from "@/lib/productionPlanStore";

const bodySchema = z.object({ plan: videoProductionPlanSchema }).strict();

async function post(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid production plan" }, { status: 400 });
  if (parsed.data.plan.revision !== 1) return Response.json({ error: "initial production plan revision must be 1" }, { status: 409 });
  try {
    return Response.json({ plan: await proposeProductionPlan(parsed.data.plan) }, { status: 201 });
  } catch (error) {
    return productionPlanError(error);
  }
}

export const POST = operatorTenantHandler(post);
