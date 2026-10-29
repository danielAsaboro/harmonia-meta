import { z } from "zod";

import { internalTenantHandler } from "@/lib/internalAuth";
import { productionPlanError } from "@/lib/productionPlanHttp";
import { claimProductionOperation } from "@/lib/productionPlanStore";

const bodySchema = z.object({
  claimToken: z.string().min(1).max(512),
  expectedPlanRevision: z.number().int().positive(),
  expectedPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  expectedInternalRun: z.number().int().nonnegative(),
}).strict();

async function post(
  request: Request,
  { params }: { params: Promise<{ id: string; operationId: string }> },
) {
  const { id, operationId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid production operation claim" }, { status: 400 });
  try {
    return Response.json(await claimProductionOperation(id, operationId, parsed.data));
  } catch (error) {
    return productionPlanError(error);
  }
}

export const POST = internalTenantHandler(post);
