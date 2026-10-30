import { operatorTenantHandler } from "@/lib/auth";
import { getProductionPlan, getProductionPlanRevision } from "@/lib/productionPlanStore";
import { productionPlanError } from "@/lib/productionPlanHttp";

async function get(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const aggregate = await getProductionPlan(id);
    if (!aggregate) return Response.json({ error: "production plan not found" }, { status: 404 });
    const revision = await getProductionPlanRevision(id, aggregate.currentRevision);
    if (!revision) return Response.json({ error: "production plan revision not found" }, { status: 409 });
    return Response.json({ aggregate, revision });
  } catch (error) {
    return productionPlanError(error);
  }
}

export const GET = operatorTenantHandler(get);
