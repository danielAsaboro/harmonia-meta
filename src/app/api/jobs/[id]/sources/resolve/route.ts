import { randomUUID } from "node:crypto";
import { operatorTenantHandler } from "@/lib/auth";
import { db, getJob, transitionStageWithOutbox } from "@/lib/firestore";
import { sealManifest } from "@/lib/sourceRegistry";
import { buildSourceRecord } from "@/lib/sourceManifest";
import { currentTenant, tenantSubjectId } from "@/lib/tenancy";
import { dispatchStageOutboxRecord } from "@/lib/stageOutboxDispatcher";
import { z } from "zod";
import { sourceRightsAuthorization, sourceRightsAuthorizationId } from "@/lib/sourceRights";
import type { SourceInput } from "@/lib/types";

const replacementSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("web"), url: z.string().url() }).strict(),
  z.object({ kind: z.literal("pasted_text"), title: z.string().min(1).max(200), text: z.string().min(1).max(200_000) }).strict(),
]);

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry"), sourceId: z.string().min(1) }).strict(),
  z.object({ action: z.literal("remove"), sourceId: z.string().min(1), reason: z.string().min(1).max(500) }).strict(),
  z.object({ action: z.literal("replace"), sourceId: z.string().min(1), reason: z.string().min(1).max(500), replacement: replacementSchema }).strict(),
  z.object({ action: z.literal("continue") }).strict(),
  z.object({ action: z.literal("reconnect"), sourceId: z.string().min(1) }).strict(),
]);

async function resume(jobId: string, next: "collect_sources" | "extract_sources" | "understand", note: string) {
  const outboxId = await transitionStageWithOutbox(jobId, "awaiting_source_resolution", next, note);
  await dispatchStageOutboxRecord(outboxId).catch((error) => console.error("source resolution dispatch failed", { outboxId, errorType: error instanceof Error ? error.name : "unknown" }));
  return next;
}

async function post(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid source resolution", detail: parsed.error.flatten() }, { status: 400 });
  const { id: jobId } = await params; const job = await getJob(jobId);
  if (job.stage !== "awaiting_source_resolution") return Response.json({ error: "job is not awaiting source resolution" }, { status: 409 });
  const tenant = currentTenant(); const sourceRoot = `workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/sources`;
  if (parsed.data.action === "reconnect") {
    const source = await db().doc(`${sourceRoot}/${parsed.data.sourceId}`).get();
    if (!source.exists) return Response.json({ error: "source not found" }, { status: 404 });
    return Response.json({ reconnectUrl: "/settings?section=brand-libraries", provider: source.get("provider") });
  }
  if (parsed.data.action === "retry") {
    const ref = db().doc(`${sourceRoot}/${parsed.data.sourceId}`);
    await db().runTransaction(async (transaction) => { const source = await transaction.get(ref); if (!source.exists || source.get("state") !== "failed") throw new Error("only failed sources can be retried"); transaction.update(ref, { state: "queued", failure: null, updatedAt: new Date().toISOString() }); });
    return Response.json({ ok: true, nextStage: await resume(jobId, "extract_sources", `operator retried source ${parsed.data.sourceId}`) });
  }
  const manifestRef = db().doc(`workspaces/${tenant.workspaceId}/jobs/${jobId}/source_manifests/${job.config.sourceManifestId}`);
  const manifestSnapshot = await manifestRef.get(); if (!manifestSnapshot.exists) return Response.json({ error: "source manifest not found" }, { status: 404 });
  const oldManifest = manifestSnapshot.data()!; const now = new Date().toISOString(); const nextManifestId = randomUUID();
  let replacementId: string | undefined;
  const excludedSourceIds = [...new Set([...((oldManifest.excludedSourceIds as string[] | undefined) ?? []), ...(parsed.data.action === "continue" ? [] : [parsed.data.sourceId])])];
  let directSourceIds = ((oldManifest.directSourceIds as string[] | undefined) ?? []).filter((id) => !excludedSourceIds.includes(id));
  let replacement: SourceInput | undefined;
  if (parsed.data.action === "replace") { replacementId = randomUUID(); directSourceIds.push(replacementId); const authorization = sourceRightsAuthorization(tenant, parsed.data.replacement.kind); replacement = { ...parsed.data.replacement, rightsAuthorizationId: sourceRightsAuthorizationId(authorization) } as SourceInput; }
  const exclusionRecords = [...((oldManifest.exclusionRecords as unknown[] | undefined) ?? []), ...(parsed.data.action === "continue" ? [] : [{ sourceId: parsed.data.sourceId, reason: parsed.data.reason, excludedAt: now, excludedBySubjectId: tenantSubjectId(tenant) }])];
  if (parsed.data.action === "continue") {
    const ids = [...directSourceIds]; const records = await Promise.all(ids.map((id) => db().doc(`${sourceRoot}/${id}`).get()));
    for (const record of records) if (record.get("state") === "failed") { excludedSourceIds.push(record.id); directSourceIds = directSourceIds.filter((id) => id !== record.id); exclusionRecords.push({ sourceId: record.id, reason: "operator continued without failed source", excludedAt: now, excludedBySubjectId: tenantSubjectId(tenant) }); }
  }
  const nextManifest = sealManifest({ id: nextManifestId, jobId, revision: Number(oldManifest.revision) + 1, ...(oldManifest.librarySnapshotId ? { librarySnapshotId: oldManifest.librarySnapshotId as string } : {}), directSourceIds, excludedSourceIds: [...new Set(excludedSourceIds)], exclusionRecords: exclusionRecords as never[], sealedAt: now, sealedBySubjectId: tenantSubjectId(tenant) });
  if (parsed.data.action === "remove" || parsed.data.action === "continue") {
    const active = await Promise.all(directSourceIds.map((id) => db().doc(`${sourceRoot}/${id}`).get()));
    const hasReady = active.some((record) => record.get("state") === "ready") || Boolean(oldManifest.librarySnapshotId);
    if (!hasReady) return Response.json({ error: "cannot continue without at least one ready source" }, { status: 409 });
  }
  await db().runTransaction(async (transaction) => {
    transaction.create(db().doc(`workspaces/${tenant.workspaceId}/jobs/${jobId}/source_manifests/${nextManifestId}`), nextManifest);
    transaction.update(db().doc(`workspaces/${tenant.workspaceId}/jobs/${jobId}`), { "config.sourceManifestId": nextManifestId, updatedAt: now });
    if (parsed.data.action !== "continue") transaction.update(db().doc(`${sourceRoot}/${parsed.data.sourceId}`), { state: "excluded", updatedAt: now });
    if (parsed.data.action === "replace" && replacementId && replacement) { const record = buildSourceRecord(replacement, replacementId, now); transaction.create(db().doc(`${sourceRoot}/${replacementId}`), record); transaction.create(db().doc(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/source_payloads/${replacementId}`), { sourceId: replacementId, input: replacement, createdAt: now }); }
  });
  if (parsed.data.action === "remove" || parsed.data.action === "continue") {
    return Response.json({ ok: true, manifest: nextManifest, nextStage: await resume(jobId, "understand", "operator sealed source resolution") });
  }
  return Response.json({ ok: true, manifest: nextManifest, nextStage: await resume(jobId, "collect_sources", "operator replaced failed source") });
}

export const POST = operatorTenantHandler(post);
