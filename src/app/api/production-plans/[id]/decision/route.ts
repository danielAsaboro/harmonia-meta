import { z } from "zod";

import { administratorTenantHandler } from "@/lib/auth";
import { productionPlanError } from "@/lib/productionPlanHttp";
import { approveProductionPlan, rejectProductionPlan } from "@/lib/productionPlanStore";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const bodySchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("approved"), planDigest: digest, expiresAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({ decision: z.literal("rejected"), planDigest: digest, feedback: z.string().trim().min(1).max(4000) }).strict(),
]);

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid production plan decision" }, { status: 400 });
  try {
    if (parsed.data.decision === "approved") {
      const { decision: _decision, ...approval } = parsed.data;
      return Response.json({ mandate: await approveProductionPlan(id, approval) });
    }
    const { decision: _decision, ...rejection } = parsed.data;
    return Response.json({ plan: await rejectProductionPlan(id, rejection) });
  } catch (error) {
    return productionPlanError(error);
  }
}

export const POST = administratorTenantHandler(post);
