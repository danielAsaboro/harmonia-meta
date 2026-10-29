import { createHash } from "node:crypto";

import { durableEventClaimSchema } from "@/lib/contracts";
import { claimDurableEvent } from "@/lib/firestore";
import { eventPayloadDigest } from "@/lib/eventInbox";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, durableEventClaimSchema, async (body) => {
    const now = new Date();
    const result = await claimDurableEvent({
      envelope: body.envelope,
      pubsubMessageId: body.pubsubMessageId,
      ownerTokenDigest: digest(body.claimToken),
      now: now.toISOString(),
      claimUntil: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
      replayPolicy: "safe",
      operation: {
        id: body.envelope.operationId,
        workspaceId: body.envelope.workspaceId,
        brandId: body.envelope.brandId,
        jobId: body.envelope.jobId,
        kind: body.envelope.payload.stage === "verify" ? "verification" : "stage",
        goal: {
          type: body.envelope.eventType,
          version: body.envelope.schemaVersion,
          digest: eventPayloadDigest({
            eventType: body.envelope.eventType,
            operationId: body.envelope.operationId,
            payloadDigest: body.envelope.payloadDigest,
            schemaVersion: body.envelope.schemaVersion,
          }),
          acceptance: ["the requested stage transition is durably finalized"],
        },
        ...(body.envelope.causationId ? { causalParentId: body.envelope.causationId } : {}),
        correlationId: body.envelope.correlationId,
        replayPolicy: "safe",
        maxAttempts: 3,
        now: now.toISOString(),
      },
    });
    return Response.json(result);
  });
}
