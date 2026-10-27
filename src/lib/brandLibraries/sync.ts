import type { BrandLibraryConnection } from "./contracts";
import { randomUUID } from "node:crypto";
import { db } from "../firestore";
import { validPlatformConnection } from "../validConnection";
import { getArtifact, putArtifact } from "../storage";
import { currentTenant } from "../tenancy";
import type { SourceRecord } from "../types";
import { extractLibraryBytes } from "./extractionClient";
import { downloadDriveFile, listDriveFolderFiles, listDriveFolders, type DriveFileVersion } from "./googleDrive";
import { downloadPinnedObject, listPinnedObjects } from "./gcs";
import { beginLibrarySync, failLibrarySync, finalizeLibrarySyncOperation, promoteHealthySnapshot } from "./repository";
import type { LibraryFileVersion } from "./contracts";

const CADENCE_MS = { hourly: 3_600_000, six_hours: 21_600_000, daily: 86_400_000 } as const;
export function nextSyncAt(connection: Pick<BrandLibraryConnection, "cadence" | "updatedAt" | "pausedAt" | "revokedAt">): string | null {
  if (connection.cadence === "paused" || connection.pausedAt || connection.revokedAt) return null;
  return new Date(Date.parse(connection.updatedAt) + CADENCE_MS[connection.cadence]).toISOString();
}
export function isSyncDue(connection: Pick<BrandLibraryConnection, "cadence" | "updatedAt" | "pausedAt" | "revokedAt"> & Partial<Pick<BrandLibraryConnection, "lastSyncStatus" | "nextEligibleRetryAt">>, now: string): boolean {
  if (connection.lastSyncStatus === "reconnection_required" || connection.lastSyncStatus === "permanent_failure") return false;
  if (connection.nextEligibleRetryAt && Date.parse(connection.nextEligibleRetryAt) > Date.parse(now)) return false;
  const next = nextSyncAt(connection); return Boolean(next && Date.parse(next) <= Date.parse(now));
}

export function classifyLibrarySyncFailure(error: unknown, retryCount: number, now = new Date()): { code: string; category: "transient" | "reconnection_required" | "permanent"; publicMessage: string; retryCount: number; nextEligibleRetryAt?: string } {
  const message = error instanceof Error ? error.message : String(error);
  const reconnect = /reconnect|credential|unauthorized|forbidden|401|403|connection not found|refresh.*quarantined/i.test(message);
  const transient = /timeout|429|rate|temporar|unavailable|502|503|504|network|version changed|refresh is already in progress/i.test(message);
  const category = reconnect ? "reconnection_required" as const : transient ? "transient" as const : "permanent" as const;
  const nextRetry = category === "transient" ? new Date(now.getTime() + Math.min(86_400_000, 60_000 * (2 ** Math.min(retryCount, 10)))).toISOString() : undefined;
  return { code: error instanceof Error ? error.name : "sync_error", category, publicMessage: message.slice(0, 240), retryCount, ...(nextRetry ? { nextEligibleRetryAt: nextRetry } : {}) };
}

const supportedMime = (mime: string) => mime.startsWith("text/") || mime.startsWith("audio/") || mime.startsWith("video/") || ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/vnd.google-apps.document", "application/vnd.google-apps.presentation", "application/vnd.google-apps.spreadsheet"].includes(mime);
type Enumerated = { providerResourceId: string; providerVersion: string; title: string; mimeType: string; size: number; download: () => Promise<{ bytes: Buffer; mimeType: string }> };

async function enumerateDrive(connection: BrandLibraryConnection): Promise<Enumerated[]> {
  if (connection.selector.provider !== "google_drive") return [];
  const credential = await validPlatformConnection("google-drive");
  const queue = [connection.selector.folderId]; const files: DriveFileVersion[] = [];
  while (queue.length) { const folderId = queue.shift()!; let token: string | undefined;
    do { const page = await listDriveFolders(credential.accessToken, folderId, token); queue.push(...page.folders.map((folder) => folder.id)); token = page.nextPageToken; } while (token);
    token = undefined; do { const page = await listDriveFolderFiles(credential.accessToken, folderId, token); files.push(...page.files); token = page.nextPageToken; } while (token);
    if (files.length > connection.policy.maximumFiles) throw new Error("brand library exceeds maximum file count");
  }
  return files.filter((file) => supportedMime(file.mimeType)).map((file) => ({ providerResourceId: file.id, providerVersion: String(file.version ?? file.md5Checksum ?? file.modifiedTime ?? "unknown"), title: file.name, mimeType: file.mimeType, size: Number(file.size ?? 0), download: () => downloadDriveFile(credential.accessToken, file) }));
}

async function enumerateGcs(connection: BrandLibraryConnection): Promise<Enumerated[]> {
  if (connection.selector.provider !== "gcs") return [];
  const selector = connection.selector;
  const values: Enumerated[] = []; let token: string | undefined;
  do { const page = await listPinnedObjects(selector.projectId, selector.bucket, selector.prefix, token); for (const object of page.objects) { const mime = String(object.mimeType ?? "application/octet-stream"); if (!supportedMime(mime) || !object.generation) continue; const generation = String(object.generation); values.push({ providerResourceId: `${object.bucket}/${object.name}`, providerVersion: generation, title: object.name.split("/").pop() || object.name, mimeType: mime, size: Number(object.size ?? 0), download: async () => ({ bytes: await downloadPinnedObject(selector.projectId, object.bucket, object.name, generation), mimeType: mime }) }); } token = page.nextPageToken; if (values.length > connection.policy.maximumFiles) throw new Error("brand library exceeds maximum file count"); } while (token);
  return values;
}

export async function runLibrarySync(connectionId: string, expectedRevision: number): Promise<{ operationId: string; snapshotId: string; fileCount: number }> {
  const claimed = await beginLibrarySync(connectionId, expectedRevision); const { connection } = claimed; const tenant = currentTenant(); const connectionRoot = db().doc(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/brand_libraries/${connectionId}`); const sourceRoot = db().collection(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/sources`);
  try {
    await connectionRoot.collection("sync_operations").doc(claimed.id).update({ status: "enumerating" });
    const enumerated = connection.selector.provider === "google_drive" ? await enumerateDrive(connection) : await enumerateGcs(connection);
    if (!enumerated.length) throw new Error("brand library contains no supported source files");
    const totalBytes = enumerated.reduce((sum, file) => sum + file.size, 0); if (totalBytes > connection.policy.maximumBytes) throw new Error("brand library exceeds maximum byte policy");
    const existingSnapshot = await sourceRoot.get(); const existing = existingSnapshot.docs.map((doc) => doc.data() as SourceRecord); const versions: LibraryFileVersion[] = [];
    await connectionRoot.collection("sync_operations").doc(claimed.id).update({ status: "extracting", enumeratedFiles: enumerated.length, enumeratedBytes: totalBytes });
    let observedBytes = 0; let extractedCharacters = 0; let mediaDuration = 0;
    for (const file of enumerated) {
      const reusable = existing.find((source) => source.providerResourceId === file.providerResourceId && source.providerVersion === file.providerVersion && source.state === "ready");
      if (reusable?.normalizedArtifactId && reusable.contentDigest) { const stored = await getArtifact(reusable.normalizedArtifactId); if (stored) { const parsed = JSON.parse(stored.toString("utf8")); if (parsed.contentDigest === reusable.contentDigest) { versions.push({ sourceId: reusable.id, providerResourceId: file.providerResourceId, providerVersion: file.providerVersion, contentDigest: reusable.contentDigest, state: "ready" }); continue; } } }
      const sourceId = randomUUID(); const receiptId = `library-sync:${claimed.id}:${sourceId}`; const downloaded = await file.download(); observedBytes += downloaded.bytes.length; if (observedBytes > connection.policy.maximumBytes) throw new Error("brand library exceeds maximum byte policy"); const normalized = await extractLibraryBytes({ sourceId, title: file.title, mimeType: downloaded.mimeType, bytes: downloaded.bytes, receiptId, limits: { maximumBytes: Math.min(20 * 1024 * 1024, connection.policy.maximumBytes - (observedBytes - downloaded.bytes.length)), maximumCharacters: connection.policy.maximumExtractedCharacters - extractedCharacters, maximumMediaDurationSeconds: connection.policy.maximumMediaDurationSeconds - mediaDuration, maximumCostUsd: connection.policy.maximumSyncCostUsd } }); extractedCharacters += normalized.segments.reduce((sum, segment) => sum + segment.text.length, 0); mediaDuration += Number(normalized.metadata.durationSec ?? 0); if (extractedCharacters > connection.policy.maximumExtractedCharacters || mediaDuration > connection.policy.maximumMediaDurationSeconds) throw new Error("brand library exceeds normalized-content policy"); const artifactId = `normalized_source_${sourceId}_${normalized.contentDigest}`; await putArtifact(artifactId, Buffer.from(JSON.stringify(normalized)), "application/json"); const now = new Date().toISOString();
      const record: SourceRecord = { id: sourceId, workspaceId: tenant.workspaceId, brandId: tenant.brandId, provider: connection.selector.provider, providerResourceId: file.providerResourceId, providerVersion: file.providerVersion, title: file.title, mimeType: downloaded.mimeType, state: "ready", rightsAuthorizationId: connection.credentialReferenceId, trust: "authorized_private", contentDigest: normalized.contentDigest, normalizedArtifactId: artifactId, extractionReceiptId: receiptId, createdAt: now, updatedAt: now };
      await sourceRoot.doc(sourceId).create(record); await db().doc(`workspaces/${tenant.workspaceId}/brands/${tenant.brandId}/source_payloads/${sourceId}`).create({ sourceId, input: { kind: connection.selector.provider, connectionId, providerResourceId: file.providerResourceId, providerVersion: file.providerVersion }, createdAt: now }); versions.push({ sourceId, providerResourceId: file.providerResourceId, providerVersion: file.providerVersion, contentDigest: normalized.contentDigest, state: "ready" });
    }
    const snapshot = await promoteHealthySnapshot(connectionId, expectedRevision, claimed.id, versions); await finalizeLibrarySyncOperation(connectionId, claimed.id, "healthy"); return { operationId: claimed.id, snapshotId: snapshot.id, fileCount: versions.length };
  } catch (error) { const failure = classifyLibrarySyncFailure(error, (connection.retryCount ?? 0) + 1); await finalizeLibrarySyncOperation(connectionId, claimed.id, "failed", failure).catch(() => undefined); await failLibrarySync(connectionId, expectedRevision, failure).catch(() => undefined); throw error; }
}
