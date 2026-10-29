import { durableOperationFinalizeSchema } from "@/lib/contracts";
import { finalizeDurableOperation } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute, readOperationFenceHeaders } from "@/lib/internalHandler";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, durableOperationFinalizeSchema, async (body) => {
    const fence = readOperationFenceHeaders(req);
    if (fence.operationId !== body.operationId || fence.epoch !== body.epoch) {
      return Response.json({ error: "operation fence body/header mismatch" }, { status: 409 });
    }
    return Response.json(await finalizeDurableOperation(body.operationId, {
      epoch: body.epoch,
      state: body.state,
      now: new Date().toISOString(),
      ...(body.unresolvedReason ? { unresolvedReason: body.unresolvedReason } : {}),
      ...(body.latestProjectionId ? { latestProjectionId: body.latestProjectionId } : {}),
    }));
  }, { requireFence: true, expectedOperationId: (body) => body.operationId });
}
