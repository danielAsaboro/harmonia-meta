import { createHash } from "node:crypto";

import { durableEventFinalizeSchema } from "@/lib/contracts";
import { completeDurableEvent } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute, readOperationFenceHeaders } from "@/lib/internalHandler";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, durableEventFinalizeSchema, async (body) => {
    const fence = readOperationFenceHeaders(req);
    if (fence.epoch !== body.operationEpoch) {
      return Response.json({ error: "operation epoch body/header mismatch" }, { status: 409 });
    }
    const record = await completeDurableEvent(body.source, body.sourceEventId, {
      ownerTokenDigest: createHash("sha256").update(body.claimToken, "utf8").digest("hex"),
      outcome: body.outcome,
      now: new Date().toISOString(),
      ...(body.rejectionReason ? { rejectionReason: body.rejectionReason } : {}),
      operationId: fence.operationId,
      operationEpoch: body.operationEpoch,
      operationState: body.operationState,
      ...(body.operationReason ? { operationReason: body.operationReason } : {}),
    });
    return Response.json({ record });
  }, { requireFence: true });
}
