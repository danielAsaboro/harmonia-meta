import { db, eraseJobData, getJob, listApprovalDecisions, listAssets, listEffectClaims, listEvents, listReceipts, listReplayObservations, listUsageRecords } from "@/lib/firestore";
import { administratorTenantHandler, tenantHandler } from "@/lib/auth";
import { redactEffectClaim } from "@/lib/effectClaims";
import { actionPayloadDigest } from "@/lib/idempotency";
import { planJobDeletion } from "@/lib/lifecycle";
import { currentTenant } from "@/lib/tenancy";
import { getArtifact } from "@/lib/storage";
import { normalizedSourceSchema } from "@/lib/contracts";
import { getProductionPlanWorkspaceForJob } from "@/lib/productionPlanStore";
import { z } from "zod";
import { listCommandEffectClaimsForJob } from "@/lib/effectCommandStore";

function timestampValue(value: unknown): string | null {
  if (value && typeof value === "object" && "toDate" in value && typeof value.toDate === "function") {
    return value.toDate().toISOString();
  }
  return typeof value === "string" ? value : null;
}

async function retainedArtifactBytes(uri: unknown): Promise<Buffer | null> {
  if (typeof uri !== "string") return null;
  const match = /^gs:\/\/([^/]+)\/(.+)$/.exec(uri);
  if (!match) return null;
  const { Storage } = await import("@google-cloud/storage");
  const [bytes] = await new Storage().bucket(match[1]).file(match[2]).download().catch(() => [null]);
  return bytes;
}

async function historicalArchiveResponse(jobId: string, tenant: ReturnType<typeof currentTenant>, tombstone: FirebaseFirestore.DocumentSnapshot) {
  const artifacts = await db().collection(`workspaces/${tenant.workspaceId}/artifacts`).where("jobId", "==", jobId).get();
  const contentArtifacts = (await Promise.all(artifacts.docs
    .filter((artifact) => artifact.get("contentType") === "application/json" && (artifact.get("producer") as { kind?: string } | undefined)?.kind === "content_artifact_export")
    .map(async (artifact) => {
      const bytes = await retainedArtifactBytes(artifact.get("uri"));
      if (!bytes) return null;
      try {
        const parsed = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
        return typeof parsed.id === "string" && typeof parsed.outputType === "string" && typeof parsed.contentDigest === "string" ? parsed : null;
      } catch {
        return null;
      }
    }))).filter(Boolean);
  const sourceIds = [...new Set(contentArtifacts.flatMap((artifact) => {
    const refs = (artifact as Record<string, unknown>).sourceSegmentRefs;
    return Array.isArray(refs)
      ? refs.filter((reference): reference is string => typeof reference === "string").map((reference) => reference.split(":")[0])
      : [];
  }))];
  const sourceRecords = (await Promise.all(sourceIds.map(async (sourceId) => {
    const source = await db().doc(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/sources/${sourceId}`).get();
    return source.exists ? source.data() : null;
  }))).filter(Boolean);
  const normalizedSources = (await Promise.all(sourceRecords.map(async (record) => {
    const artifactId = (record as { normalizedArtifactId?: string }).normalizedArtifactId;
    if (!artifactId) return null;
    const bytes = await getArtifact(artifactId);
    if (!bytes) return null;
    const parsed = normalizedSourceSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    return parsed.success ? parsed.data : null;
  }))).filter(Boolean);
  const [events, receipts, assets, decisions, replays, usage, claims, commandClaims, productionPlan] = await Promise.all([
    listEvents(jobId),
    listReceipts(jobId),
    listAssets(jobId),
    listApprovalDecisions(jobId),
    listReplayObservations(jobId),
    listUsageRecords(jobId),
    listEffectClaims(jobId),
    listCommandEffectClaimsForJob(jobId),
    getProductionPlanWorkspaceForJob(jobId),
  ]);
  const allClaims = [...claims, ...commandClaims].filter((claim, index, values) =>
    values.findIndex((candidate) =>
      candidate.operationId === claim.operationId && candidate.idempotencyKey === claim.idempotencyKey,
    ) === index,
  );
  const firstArtifact = contentArtifacts[0] as Record<string, unknown> | undefined;
  const hasRecoveredOutput = contentArtifacts.length > 0;
  const archivedAt = timestampValue(tombstone.get("deletedAt")) ?? events[events.length - 1]?.at ?? "2026-08-30T11:50:37.000Z";
  return Response.json({
    job: {
      id: jobId,
      workspaceId: tenant.workspaceId,
      brandId: tenant.brandId,
      createdByUserId: tombstone.get("deletedBySubjectId") ?? "retention-service",
      config: {
        sourceManifestId: `retention-archive-${jobId}`,
        desiredOutputs: [],
        allowedOutputs: [],
        platforms: [],
      },
      controlEpoch: 0,
      controlState: "cancelled",
      retentionHold: true,
      stage: hasRecoveredOutput ? "complete" : "failed",
      status: hasRecoveredOutput ? "complete" : "failed",
      createdAt: events[0]?.at ?? archivedAt,
      updatedAt: archivedAt,
      sourceAnalysis: {
        summary: typeof firstArtifact?.title === "string" ? firstArtifact.title : "Historical job archive",
        moments: [],
        angles: [],
      },
      sourceRecords,
      normalizedSources,
      contentArtifacts,
      actions: [],
      packet: {
        generatedAt: archivedAt,
        unresolved: ["The original executable job document was erased by retention. This view contains only retained, non-runnable evidence and exported deliverables."],
        receipts,
      },
      failure: hasRecoveredOutput ? undefined : {
        stage: "retention",
        retryable: false,
        publicMessage: "The primary job was erased by retention. No exported deliverable survived for this historical record.",
      },
      historicalArchive: true,
    },
    events,
    receipts,
    decisions,
    replays,
    usage,
    claims: allClaims.map(redactEffectClaim),
    assets: assets.map((asset) => ({
      actionId: asset.actionId,
      mime: asset.mime,
      sizeBytes: asset.sizeBytes,
      digest: asset.digest,
    })),
    productionPlan,
  });
}

async function get(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const tenant = currentTenant();
  let job: Awaited<ReturnType<typeof getJob>>;
  try {
    job = await getJob(id);
  } catch (error) {
    const tombstone = await db().doc(`workspaces/${tenant.workspaceId}/deletion_tombstones/${id}`).get();
    if (tombstone.exists && tombstone.get("contentErased") === true) {
      return historicalArchiveResponse(id, tenant, tombstone);
    }
    throw error;
  }
  const manifestSnapshot = await db().doc(`workspaces/${tenant.workspaceId}/jobs/${id}/source_manifests/${job.config.sourceManifestId}`).get();
  const manifest = manifestSnapshot.data() as { directSourceIds?: string[]; librarySnapshotId?: string } | undefined;
  let sourceIds = [...(manifest?.directSourceIds ?? [])];
  if (manifest?.librarySnapshotId) {
    const libraries = await db().collection(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/brand_libraries`).get();
    for (const library of libraries.docs) {
      const snapshot = await library.ref.collection("snapshots").doc(manifest.librarySnapshotId).get();
      if (snapshot.exists) {
        sourceIds.push(...((snapshot.get("fileVersions") as Array<{ sourceId: string }> | undefined) ?? []).map((item) => item.sourceId));
        break;
      }
    }
  }
  sourceIds = [...new Set(sourceIds)];
  const sourceRecords = (await Promise.all(sourceIds.map(async (sourceId) => {
    const snapshot = await db().doc(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/sources/${sourceId}`).get();
    return snapshot.exists ? snapshot.data() : null;
  }))).filter(Boolean);
  const normalizedSources = (await Promise.all(sourceRecords.map(async (record) => {
    const artifactId = (record as { normalizedArtifactId?: string }).normalizedArtifactId;
    if (!artifactId) return null;
    const bytes = await getArtifact(artifactId);
    if (!bytes) return null;
    const parsed = normalizedSourceSchema.safeParse(JSON.parse(bytes.toString("utf8")));
    return parsed.success ? parsed.data : null;
  }))).filter(Boolean);
  const [events, receipts, assets, decisions, replays, usage, claims, commandClaims, productionPlan] = await Promise.all([
    listEvents(id),
    listReceipts(id),
    listAssets(id),
    listApprovalDecisions(id),
    listReplayObservations(id),
    listUsageRecords(id),
    listEffectClaims(id),
    listCommandEffectClaimsForJob(id),
    getProductionPlanWorkspaceForJob(id),
  ]);
  const allClaims = [...claims, ...commandClaims].filter((claim, index, values) =>
    values.findIndex((candidate) =>
      candidate.operationId === claim.operationId && candidate.idempotencyKey === claim.idempotencyKey,
    ) === index,
  );
  return Response.json({
    job: { ...job, sourceRecords, normalizedSources, productionPlan, actions: job.actions.map((action) => ({ ...action, payloadDigest: actionPayloadDigest(action) })) },
    events,
    receipts,
    decisions,
    replays,
    usage,
    claims: allClaims.map(redactEffectClaim),
    assets: assets.map((a) => ({
      actionId: a.actionId,
      mime: a.mime,
      sizeBytes: a.sizeBytes,
      digest: a.digest,
    })),
  });
}

export const GET = tenantHandler(get);

const DeleteBody = z.object({
  confirmation: z.string().min(1),
  reason: z.string().min(1).max(2000),
}).strict();

async function del(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid deletion request" }, { status: 400 });
  try {
    const job = await getJob(id);
    const plan = planJobDeletion({
      job,
      confirmation: parsed.data.confirmation,
      reason: parsed.data.reason,
    });
    await eraseJobData(plan, currentTenant().principal.subjectId);
    return Response.json({ ok: true, jobId: id, contentErased: true });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "job deletion failed" },
      { status: 409 },
    );
  }
}

export const DELETE = administratorTenantHandler(del);
