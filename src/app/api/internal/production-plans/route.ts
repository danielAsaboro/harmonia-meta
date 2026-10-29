import { z } from "zod";

import { internalTenantHandler } from "@/lib/internalAuth";
import { videoProductionPlanSchema } from "@/lib/mediaProduction";
import { productionPlanError } from "@/lib/productionPlanHttp";
import { proposeProductionPlan } from "@/lib/productionPlanStore";

const bodySchema = z.object({ plan: videoProductionPlanSchema }).strict();

async function post(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid production plan" }, { status: 400 });
  try {
    return Response.json({ plan: await proposeProductionPlan(parsed.data.plan) }, { status: 201 });
  } catch (error) {
    return productionPlanError(error);
  }
}

export const POST = internalTenantHandler(post);
