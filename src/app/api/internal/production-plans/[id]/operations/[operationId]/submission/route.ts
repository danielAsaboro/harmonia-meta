import { z } from "zod";

import { internalTenantHandler } from "@/lib/internalAuth";
import { productionPlanError } from "@/lib/productionPlanHttp";
import { startProductionProviderSubmission } from "@/lib/productionPlanStore";

const bodySchema = z.object({
  claimId: z.string().min(1).max(256),
  claimToken: z.string().min(1).max(512),
  provider: z.enum(["veo", "lyria"]),
}).strict();

async function post(
  request: Request,
  { params }: { params: Promise<{ id: string; operationId: string }> },
) {
  const { id, operationId } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid production provider submission" }, { status: 400 });
  try {
    return Response.json({ claim: await startProductionProviderSubmission(id, operationId, parsed.data) });
  } catch (error) {
    return productionPlanError(error);
  }
}

export const POST = internalTenantHandler(post);
