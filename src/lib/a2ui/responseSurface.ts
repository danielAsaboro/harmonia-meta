import type { ChatResponse } from "@/app/api/chat/route";
import type { JobFull, Receipt } from "@/components/jobTypes";
import { requestSurfacePlan } from "./agentPresentationClient";
import { hydrateSurfacePlan, type HydratedSurfaceSet } from "./hydrateSurfacePlan";
import { buildUiContext } from "./presentationContext";
import { surfacePlanSchema, validateSurfacePlan, type SurfacePlan, type UiContext } from "./presentationContracts";

interface GenerateResponseSurfacesInput {
  runId: string;
  message: string;
  response: ChatResponse;
  job?: JobFull | null;
  receipts: Receipt[];
  planner?: (context: UiContext) => Promise<SurfacePlan>;
}

export async function generateResponseSurfaces(input: GenerateResponseSurfacesInput): Promise<HydratedSurfaceSet> {
  if (!input.job) throw new Error("A2UI presentation requires a hydrated active job");
  const context = buildUiContext({
    runId: input.runId,
    message: input.message,
    response: input.response,
    job: input.job,
    receipts: input.receipts,
  });
  const planned = await (input.planner ?? requestSurfacePlan)(context);
  const plan = validateSurfacePlan(context, surfacePlanSchema.parse(planned));
  return hydrateSurfacePlan({
    runId: input.runId,
    plan,
    job: input.job,
    receipts: input.receipts,
  });
}
