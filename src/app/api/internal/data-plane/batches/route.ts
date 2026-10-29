import { z } from "zod";

import { dataBatchSchema, dataWorkItemSchema } from "@/lib/dataPlane/contracts";
import { DataPlaneRepository } from "@/lib/dataPlane/repository";
import { db } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";

const bodySchema = z.object({ batch: dataBatchSchema, workItems: z.array(dataWorkItemSchema).min(1).max(1_000_000) }).strict();

async function post(req: Request) {
  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid data batch", detail: parsed.error.flatten() }, { status: 400 });
  await new DataPlaneRepository(db()).create(parsed.data.batch, parsed.data.workItems);
  return Response.json({ batchId: parsed.data.batch.id, acceptedItems: parsed.data.workItems.length }, { status: 201 });
}

export const POST = internalTenantHandler(post);
