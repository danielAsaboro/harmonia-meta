import { createHash } from "node:crypto";

import { durableOperationClaimSchema } from "@/lib/contracts";
import { claimDurableOperation } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, durableOperationClaimSchema, async (body) => {
    const now = new Date();
    return Response.json(await claimDurableOperation(body.operationId, {
      ownerId: body.ownerId,
      ownerTokenDigest: createHash("sha256").update(body.claimToken, "utf8").digest("hex"),
      now: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
    }));
  });
}
