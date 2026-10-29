import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";
import { deriveEligibleObservations, microReflectionEventSchema } from "@/lib/residentAutonomy/microReflection";
import { createImmutableResidentRecord } from "@/lib/residentAutonomy/repository";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, microReflectionEventSchema, async (body) => {
    const observations = deriveEligibleObservations(body);
    const results = await Promise.all(observations.map((observation) => createImmutableResidentRecord("observations", observation)));
    return Response.json({ accepted: observations.length, created: results.filter((result) => result.created).length });
  });
}
