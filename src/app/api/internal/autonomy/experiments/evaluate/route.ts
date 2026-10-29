import { z } from "zod";
import { internalTenantHandler } from "@/lib/internalAuth";
import { experimentSchema, observationSchema } from "@/lib/residentAutonomy/contracts";
import { evaluateExperiment } from "@/lib/residentAutonomy/experiments";

const bodySchema = z.object({ experiment: experimentSchema, observations: z.array(observationSchema).max(500), metrics: z.object({ baselineMetric: z.number(), candidateMetric: z.number(), unresolvedContradictions: z.boolean(), budgetAvailable: z.boolean() }).strict() }).strict();
export const POST = internalTenantHandler(async (req) => {
  const body = bodySchema.parse(await req.json());
  return Response.json(evaluateExperiment(body.experiment, body.observations, body.metrics));
});
