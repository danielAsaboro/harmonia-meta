import { DataPlaneRepository } from "@/lib/dataPlane/repository";
import { db } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";

async function get(_req: Request, context: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await context.params;
  return Response.json({ outcome: await new DataPlaneRepository(db()).outcome(batchId) });
}

export const GET = internalTenantHandler(get);
