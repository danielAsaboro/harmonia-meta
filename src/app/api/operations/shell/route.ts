import { operatorTenantHandler } from "@/lib/auth";
import { db, listConnectionMetadata, listJobs } from "@/lib/firestore";
import { getDurableRuntimeSnapshot } from "@/lib/observability/repository";
import { projectAttentionItems } from "@/lib/operations/attention";
import { buildAttentionSources } from "@/lib/operations/attentionSources";
import { compileJobShells } from "@/lib/operations/projection";
import { OperationalUpdateFeedStore } from "@/lib/operations/updateFeedStore";
import { attentionRequestSchema } from "@/lib/residentAutonomy/contracts";
import { listResidentRecords } from "@/lib/residentAutonomy/repository";
import { currentTenant } from "@/lib/tenancy";

async function get(req: Request) {
  const url = new URL(req.url);
  const afterRaw = url.searchParams.get("after") ?? "-1";
  const after = Number(afterRaw);
  if (!Number.isInteger(after) || after < -1) return Response.json({ error: "invalid operational cursor" }, { status: 400 });

  const [jobs, connections, runtime, residentRecords] = await Promise.all([
    listJobs(100), listConnectionMetadata(), getDurableRuntimeSnapshot(), listResidentRecords("attention", 100),
  ]);
  const tenant = currentTenant();
  const residentAttention = attentionRequestSchema.array().parse(residentRecords);
  const attention = projectAttentionItems(buildAttentionSources({
    workspaceId: tenant.workspaceId,
    brandId: tenant.brandId,
    jobs,
    connectedPlatforms: connections.filter((connection) => (connection.health ?? "active") === "active").map((connection) => connection.platform),
    unknownEffects: runtime.unknownEffects,
    residentAttention,
  }));
  const shells = compileJobShells({ jobs, attention, unknownEffects: runtime.unknownEffects, lastEventSequence: -1 });
  const store = new OperationalUpdateFeedStore(db());
  await store.synchronize({ jobs: shells, attention, occurredAt: new Date().toISOString() });
  const snapshotSequence = await store.headSequence();
  const updates = after >= 0 && after < snapshotSequence ? await store.listAfter(after) : [];
  return Response.json({
    snapshot: {
      snapshotSequence,
      jobs: Object.fromEntries(shells.map((shell) => [shell.jobId, shell])),
      attention: Object.fromEntries(attention.map((item) => [item.id, item])),
    },
    updates,
    resumable: true,
  });
}

export const GET = operatorTenantHandler(get);
