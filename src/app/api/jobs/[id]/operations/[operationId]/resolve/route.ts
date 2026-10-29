import { z } from "zod";

import { operatorTenantHandler } from "@/lib/auth";
import { resolveUnknownOperation } from "@/lib/operationResolution";

const schema = z.object({
  choice: z.enum(["confirm_applied", "confirm_not_applied", "compensate", "cancel"]),
  reason: z.string().trim().min(10).max(2000),
  expectedEpoch: z.number().int().positive(),
  evidence: z.array(z.object({
    artifactId: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict()).min(1).max(20),
}).strict();

async function post(req: Request, { params }: { params: Promise<{ id: string; operationId: string }> }) {
  const { id, operationId } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid operation resolution" }, { status: 400 });
  const result = await resolveUnknownOperation(id, operationId, parsed.data);
  return Response.json(result, { status: result.duplicate ? 200 : 201 });
}

export const POST = operatorTenantHandler(post);
