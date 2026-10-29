import { createHash } from "node:crypto";
import { z } from "zod";

import { DataPlaneRepository } from "@/lib/dataPlane/repository";
import { db } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";

const bodySchema = z.object({
  claimToken: z.string().min(32).max(500), epoch: z.number().int().positive(), outcome: z.enum(["succeeded", "failed", "cancelled"]),
  artifactIds: z.array(z.string().regex(/^[A-Za-z0-9_-]{1,300}$/)).max(100), failureCode: z.string().min(1).max(100).optional(),
  now: z.string().datetime({ offset: true }),
}).strict();

async function post(req: Request, context: { params: Promise<{ batchId: string; itemId: string }> }) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid data work finalization", detail: parsed.error.flatten() }, { status: 400 });
  const { batchId, itemId } = await context.params;
  const { claimToken, ...input } = parsed.data;
  const item = await new DataPlaneRepository(db()).finalize(batchId, itemId, {
    ...input, ownerTokenDigest: createHash("sha256").update(claimToken).digest("hex"),
  });
  return Response.json({ item });
}

export const POST = internalTenantHandler(post);
