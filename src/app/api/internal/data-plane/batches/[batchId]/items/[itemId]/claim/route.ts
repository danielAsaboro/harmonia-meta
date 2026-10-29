import { createHash } from "node:crypto";
import { z } from "zod";

import { DataPlaneRepository } from "@/lib/dataPlane/repository";
import { db } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";
import { currentTenant } from "@/lib/tenancy";

const bodySchema = z.object({ claimToken: z.string().min(32).max(500), now: z.string().datetime({ offset: true }), leaseExpiresAt: z.string().datetime({ offset: true }) }).strict();

async function post(req: Request, context: { params: Promise<{ batchId: string; itemId: string }> }) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid data work claim", detail: parsed.error.flatten() }, { status: 400 });
  const { batchId, itemId } = await context.params;
  const result = await new DataPlaneRepository(db()).claim(batchId, itemId, {
    ownerId: currentTenant().principal.subjectId,
    ownerTokenDigest: createHash("sha256").update(parsed.data.claimToken).digest("hex"),
    now: parsed.data.now,
    leaseExpiresAt: parsed.data.leaseExpiresAt,
  });
  return Response.json(result);
}

export const POST = internalTenantHandler(post);
