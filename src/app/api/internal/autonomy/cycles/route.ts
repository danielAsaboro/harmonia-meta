import { autonomyCycleSchema } from "@/lib/residentAutonomy/contracts";
import { createResidentCycle, listResidentCycles } from "@/lib/residentAutonomy/repository";
import { internalTenantHandler } from "@/lib/internalAuth";

export const GET = internalTenantHandler(async () => Response.json({ cycles: await listResidentCycles() }));
export const POST = internalTenantHandler(async (req) => {
  const cycle = autonomyCycleSchema.parse(await req.json());
  return Response.json({ ...(await createResidentCycle(cycle)), cycle }, { status: 201 });
});
