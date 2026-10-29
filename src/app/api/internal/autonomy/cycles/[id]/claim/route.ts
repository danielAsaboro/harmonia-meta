import { z } from "zod";
import { internalTenantHandler } from "@/lib/internalAuth";
import { claimPersistedCycle } from "@/lib/residentAutonomy/repository";

const claimSchema = z.object({ ownerId: z.string().min(1), claimToken: z.string().min(16), now: z.string().datetime({ offset: true }), leaseExpiresAt: z.string().datetime({ offset: true }) }).strict();
export const POST = internalTenantHandler(async (req, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  return Response.json(await claimPersistedCycle(id, claimSchema.parse(await req.json())));
});
