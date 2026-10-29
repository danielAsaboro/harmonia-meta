import { stageExecutionClaimSchema } from "@/lib/contracts";
import { claimJobStageExecution } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, stageExecutionClaimSchema, async (body) => {
    return Response.json(await claimJobStageExecution(body));
  });
}
