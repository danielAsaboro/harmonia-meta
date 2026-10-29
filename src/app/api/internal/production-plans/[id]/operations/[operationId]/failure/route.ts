import { z } from "zod";

import { internalTenantHandler } from "@/lib/internalAuth";
import { productionPlanError } from "@/lib/productionPlanHttp";
import { recordProductionOperationFailure } from "@/lib/productionPlanStore";

const bodySchema = z.object({
  claimId: z.string().min(1).max(256),
  claimToken: z.string().min(1).max(512),
  outcome: z.enum(["failed", "uncertain"]),
  reason: z.string().min(1).max(2000),
}).strict();

async function post(
  request: Request,
  { params }: { params: Promise<{ id: string; operationId: string }> },
) {
  const { id, operationId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid production operation failure" }, { status: 400 });
  try {
    return Response.json({ claim: await recordProductionOperationFailure(id, operationId, parsed.data) });
  } catch (error) {
    return productionPlanError(error);
  }
}

export const POST = internalTenantHandler(post);
