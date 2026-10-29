import { z } from "zod";

import { administratorTenantHandler } from "@/lib/auth";
import { db } from "@/lib/firestore";
import { createCommandEnvelope, jobControlActionSchema } from "@/lib/operations/commands";
import { JobControlCommandStore } from "@/lib/operations/commandStore";
import { currentTenant } from "@/lib/tenancy";

const requestSchema = z.object({
  commandId: z.string().regex(/^[A-Za-z0-9:_-]{1,300}$/),
  action: jobControlActionSchema,
  expectedControlEpoch: z.number().int().nonnegative(),
  confirmation: z.string().min(1).max(500).optional(),
}).strict();

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid job control command", detail: parsed.error.flatten() }, { status: 400 });
  const { id } = await params;
  const tenant = currentTenant();
  if (tenant.principal.kind !== "firebase_user") return Response.json({ error: "Firebase operator required" }, { status: 403 });
  const command = createCommandEnvelope({
    ...parsed.data,
    jobId: id,
    actor: {
      actorType: "firebase_operator",
      subjectId: tenant.principal.subjectId,
      authenticationId: tenant.principal.authenticationId,
    },
    receivedAt: new Date().toISOString(),
  });
  const receipt = await new JobControlCommandStore(db()).record(command);
  return Response.json({ receipt }, { status: receipt.accepted ? 200 : 409 });
}

export const POST = administratorTenantHandler(post);
