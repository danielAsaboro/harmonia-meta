import { operatorTenantHandler } from "@/lib/auth";
import { db } from "@/lib/firestore";
import { assertResourceWorkspace, currentTenant, tenantSubjectId } from "@/lib/tenancy";
import { outputRevisionSchema, planOutputRevision } from "@/lib/outputRevision";

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = outputRevisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid output correction" }, { status: 400 });
  const { id } = await params;
  const scope = currentTenant();
  const ref = db().doc(`workspaces/${scope.workspaceId}/jobs/${id}`);
  try {
    const result = await db().runTransaction(async (tx) => {
      const snapshot = await tx.get(ref);
      if (!snapshot.exists) throw new Error("job not found");
      const job = snapshot.data()!;
      assertResourceWorkspace(scope, job as { workspaceId: string; brandId?: string });
      const revision = planOutputRevision(job as Parameters<typeof planOutputRevision>[0], parsed.data.expectedControlEpoch, parsed.data.desiredOutputs);
      const now = new Date().toISOString();
      tx.update(ref, { ...revision, updatedAt: now });
      tx.create(ref.collection("output_revisions").doc(String(revision.controlEpoch)), {
        before: job.config, after: revision.config, controlEpoch: revision.controlEpoch,
        actor: tenantSubjectId(scope), createdAt: now,
      });
      return revision;
    });
    return Response.json({ ok: true, controlEpoch: result.controlEpoch });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "output correction failed" }, { status: 409 });
  }
}

export const POST = operatorTenantHandler(post);
