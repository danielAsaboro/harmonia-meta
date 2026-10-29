import { stageExecutionFinalizeSchema } from "@/lib/contracts";
import { finalizeJobStageExecution } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, stageExecutionFinalizeSchema, async (body) => {
    return Response.json(await finalizeJobStageExecution(body));
  }, {
    requireFence: true,
    expectedOperationId: (body) => body.operationId,
  });
}
