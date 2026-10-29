import { z } from "zod";

import { transitionCommandEffect } from "@/lib/effectCommandStore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute, readOperationFenceHeaders } from "@/lib/internalHandler";
import { currentTenant } from "@/lib/tenancy";

const identity = {
  commandId: z.string().min(1).max(256),
  jobId: z.string().min(1).max(256),
  actionId: z.string().min(1).max(256),
  actionType: z.string().min(1).max(100),
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  operationId: z.string().regex(/^[A-Za-z0-9:_-]{1,512}$/),
  operationEpoch: z.number().int().positive(),
  traceId: z.string().regex(/^[a-f0-9]{32}$/),
  claimToken: z.string().min(1).max(240),
};

const schema = z.discriminatedUnion("phase", [
  z.object({ ...identity, phase: z.literal("dispatched"), attempt: z.number().int().positive() }).strict(),
  z.object({
    ...identity, phase: z.literal("progress"),
    progress: z.object({
      kind: z.literal("x_thread"),
      confirmedPostIds: z.array(z.string().min(1).max(100)).min(1).max(25),
    }).strict(),
  }).strict(),
  z.object({ ...identity, phase: z.literal("provider_not_started") }).strict(),
  z.object({ ...identity, phase: z.literal("provider_pending"), providerOperationId: z.string().min(1).max(1000), nextPollAt: z.string().datetime({ offset: true }) }).strict(),
  z.object({
    ...identity, phase: z.literal("observed"),
    outcome: z.enum(["applied", "already_applied", "rejected", "failed"]),
    artifact: z.unknown().optional(), detail: z.record(z.string(), z.unknown()),
  }).strict(),
  z.object({ ...identity, phase: z.literal("unknown"), reason: z.string().min(1).max(2000) }).strict(),
]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isInternalAuthorized(req)) return unauthorized();
  const { id } = await params;
  return internalRoute(req, schema, async (body) => {
    if (body.commandId !== id) {
      return Response.json({ error: "effect command path/body mismatch" }, { status: 409 });
    }
    const header = readOperationFenceHeaders(req);
    if (body.operationId !== header.operationId || body.operationEpoch !== header.epoch) {
      return Response.json({ error: "effect transition fence body/header mismatch" }, { status: 409 });
    }
    const tenant = currentTenant();
    const command = await transitionCommandEffect(id, body.phase === "dispatched"
      ? { phase: body.phase, claimToken: body.claimToken, attempt: body.attempt }
      : body.phase === "progress"
        ? { phase: body.phase, claimToken: body.claimToken, progress: body.progress }
      : body.phase === "observed"
        ? { phase: body.phase, claimToken: body.claimToken, outcome: body.outcome, artifact: body.artifact, detail: body.detail }
        : body.phase === "provider_pending"
          ? { phase: body.phase, claimToken: body.claimToken, providerOperationId: body.providerOperationId, nextPollAt: body.nextPollAt }
        : body.phase === "unknown"
          ? { phase: body.phase, claimToken: body.claimToken, reason: body.reason }
          : { phase: body.phase, claimToken: body.claimToken }, {
      ...header, workspaceId: tenant.workspaceId, brandId: tenant.brandId,
      now: new Date().toISOString(),
    });
    return Response.json({ command });
  });
}
