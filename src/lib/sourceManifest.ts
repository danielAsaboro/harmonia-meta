import { createHash, randomUUID } from "node:crypto";

import { createJob, db } from "./firestore";
import { sealManifest } from "./sourceRegistry";
import { currentTenant, tenantSubjectId } from "./tenancy";
import type { AnalysisResearchRequest, Job, OutputKind, SourceInput, SourceRecord, StrategyContext } from "./types";

export interface CreateSourceJobInput {
  operatorBrief?: string;
  librarySnapshotId?: string;
  directSources: SourceInput[];
  desiredOutputs: OutputKind[];
  allowedOutputs?: OutputKind[];
  strategyContext?: StrategyContext;
  analysisResearchRequest?: AnalysisResearchRequest;
  platforms: string[];
}

const digest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

export function buildSourceRecord(input: SourceInput, id: string, now: string): SourceRecord {
  const tenant = currentTenant();
  const common = {
    id, workspaceId: tenant.workspaceId, brandId: tenant.brandId,
    state: "discovered" as const, rightsAuthorizationId: input.rightsAuthorizationId,
    createdAt: now, updatedAt: now,
  };
  switch (input.kind) {
    case "youtube": return { ...common, provider: "youtube", providerResourceId: input.url, providerVersion: digest(input.url), title: "YouTube video", mimeType: "video/youtube", trust: "public_untrusted" };
    case "web": return { ...common, provider: "web", providerResourceId: input.url, providerVersion: digest(input.url), title: new URL(input.url).hostname, mimeType: "text/html", trust: "public_untrusted" };
    case "upload": return { ...common, provider: "upload", providerResourceId: input.attachmentId, providerVersion: digest(input.attachmentId), title: "Uploaded source", mimeType: "application/octet-stream", trust: "operator_supplied" };
    case "pasted_text": return { ...common, provider: "pasted_text", providerResourceId: digest(input.text), providerVersion: digest(input.text), title: input.title, mimeType: "text/plain", trust: "operator_supplied" };
  }
}

export async function createSourceJob(input: CreateSourceJobInput): Promise<Job> {
  if (input.directSources.length > 10) throw new Error("at most ten direct sources are allowed");
  if (!input.librarySnapshotId && input.directSources.length === 0) throw new Error("at least one source is required");
  const tenant = currentTenant();
  const sourceIds = input.directSources.map(() => randomUUID());
  const manifestId = randomUUID();
  const allowedOutputs = input.allowedOutputs ?? input.desiredOutputs;
  const config = {
    sourceManifestId: manifestId,
    desiredOutputs: input.desiredOutputs,
    allowedOutputs,
    platforms: input.platforms,
    ...(input.operatorBrief ? { operatorBrief: input.operatorBrief } : {}),
    ...(input.strategyContext ? { strategyContext: input.strategyContext } : {}),
    ...(input.analysisResearchRequest ? { analysisResearchRequest: input.analysisResearchRequest } : {}),
  };
  return createJob(config, "collect_sources", (transaction, jobId, now) => {
    const manifest = sealManifest({
      id: manifestId, jobId, revision: 1,
      ...(input.librarySnapshotId ? { librarySnapshotId: input.librarySnapshotId } : {}),
      directSourceIds: sourceIds, excludedSourceIds: [], exclusionRecords: [], sealedAt: now,
      sealedBySubjectId: tenantSubjectId(tenant),
    });
    transaction.create(db().doc(`workspaces/${tenant.workspaceId}/jobs/${jobId}/source_manifests/${manifestId}`), manifest);
    input.directSources.forEach((source, index) => {
      const record = buildSourceRecord(source, sourceIds[index], now);
      transaction.create(db().doc(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/sources/${record.id}`), record);
      transaction.create(db().doc(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/source_payloads/${record.id}`), { sourceId: record.id, input: source, createdAt: now });
    });
  });
}
