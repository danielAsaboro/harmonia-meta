import { administratorTenantHandler } from "@/lib/auth";
import { eraseWorkspaceData } from "@/lib/firestore";
import { planWorkspaceDeletion } from "@/lib/lifecycle";
import { currentTenant } from "@/lib/tenancy";
import { z } from "zod";

const Body = z.object({
  confirmation: z.string().min(1),
  reason: z.string().min(1).max(2000),
}).strict();

async function del(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid workspace deletion request" }, { status: 400 });
  const tenant = currentTenant();
  try {
    const plan = planWorkspaceDeletion(
      tenant.workspaceId, parsed.data.confirmation, parsed.data.reason,
    );
    await eraseWorkspaceData(plan, tenant.principal.subjectId);
    return Response.json({ ok: true, workspaceId: tenant.workspaceId, contentErased: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "workspace deletion failed" },
      { status: 409 },
    );
  }
}

export const DELETE = administratorTenantHandler(del);
