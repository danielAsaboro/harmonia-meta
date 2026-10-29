import { z } from "zod";
import { cycleStateSchema } from "@/lib/residentAutonomy/contracts";
import { internalTenantHandler } from "@/lib/internalAuth";
import { transitionPersistedCycle } from "@/lib/residentAutonomy/repository";

const transitionSchema = z.object({ state: cycleStateSchema, at: z.string().datetime({ offset: true }), claimToken: z.string().min(16), outcome: z.string().min(1).max(200) }).strict();
export const POST = internalTenantHandler(async (req, context: { params: Promise<{ id: string }> }) => {
  const { id } = await context.params;
  return Response.json({ cycle: await transitionPersistedCycle(id, transitionSchema.parse(await req.json())) });
});
