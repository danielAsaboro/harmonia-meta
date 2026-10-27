import { createHash, randomUUID } from "node:crypto";
import { FieldValue } from "@google-cloud/firestore";
import { db } from "../firestore";
import { currentTenant } from "../tenancy";
import { brandLibraryConnectionSchema, brandLibrarySnapshotSchema, type BrandLibraryConnection, type BrandLibrarySnapshot, type LibraryFileVersion } from "./contracts";

const root = () => db().collection(`workspaces/${currentTenant().workspaceId}/brands/${currentTenant().brandId}/brand_libraries`);

export async function createLibraryConnection(input: Omit<BrandLibraryConnection, "id" | "workspaceId" | "brandId" | "revision" | "createdAt" | "updatedAt" | "lastSyncStatus" | "retryCount">): Promise<BrandLibraryConnection> {
  const tenant = currentTenant(); const now = new Date().toISOString();
  const connection = brandLibraryConnectionSchema.parse({ ...input, id: randomUUID(), workspaceId: tenant.workspaceId, brandId: tenant.brandId, revision: 1, lastSyncStatus: "never", retryCount: 0, createdAt: now, updatedAt: now });
  await root().doc(connection.id).create(connection); return connection;
}

export async function listLibraryConnections(): Promise<BrandLibraryConnection[]> {
  const snapshot = await root().orderBy("createdAt", "desc").get();
  return snapshot.docs.map((doc) => brandLibraryConnectionSchema.parse(doc.data()));
}

export async function getLibraryConnection(id: string): Promise<BrandLibraryConnection> {
  const snapshot = await root().doc(id).get();
  if (!snapshot.exists) throw new Error("library connection not found");
  return brandLibraryConnectionSchema.parse(snapshot.data());
}

export async function beginLibrarySync(connectionId: string, expectedRevision: number): Promise<{ id: string; connection: BrandLibraryConnection }> {
  const ref = root().doc(connectionId); const operationId = randomUUID(); const now = new Date().toISOString(); let connection!: BrandLibraryConnection;
  await db().runTransaction(async (transaction) => {
    const snapshot = await transaction.get(ref); connection = brandLibraryConnectionSchema.parse(snapshot.data());
    if (connection.revision !== expectedRevision || connection.revokedAt || connection.cadence === "paused" || connection.lastSyncStatus === "reconnection_required" || connection.lastSyncStatus === "permanent_failure" || (connection.nextEligibleRetryAt && Date.parse(connection.nextEligibleRetryAt) > Date.now())) throw new Error("library connection cannot be synchronized at this revision");
    if (connection.lastSyncStatus === "running") throw new Error("library sync already running");
    transaction.create(ref.collection("sync_operations").doc(operationId), { id: operationId, connectionId, expectedConnectionRevision: expectedRevision, status: "claimed", startedAt: now });
    transaction.update(ref, { lastSyncStatus: "running", updatedAt: now });
  });
  return { id: operationId, connection };
}

export async function latestHealthySnapshot(connectionId: string): Promise<BrandLibrarySnapshot | null> {
  const connection = await root().doc(connectionId).get();
  if (!connection.exists) throw new Error("library connection not found");
  const id = connection.get("currentHealthySnapshotId") as string | undefined;
  if (!id) return null;
  const snapshot = await connection.ref.collection("snapshots").doc(id).get();
  return snapshot.exists ? brandLibrarySnapshotSchema.parse(snapshot.data()) : null;
}

export async function promoteHealthySnapshot(connectionId: string, expectedRevision: number, syncOperationId: string, files: LibraryFileVersion[]): Promise<BrandLibrarySnapshot> {
  const connectionRef = root().doc(connectionId); const now = new Date().toISOString(); const snapshotId = randomUUID();
  const canonical = [...files].sort((a, b) => a.providerResourceId.localeCompare(b.providerResourceId));
  const snapshot = brandLibrarySnapshotSchema.parse({ id: snapshotId, connectionId, revision: expectedRevision, syncOperationId, status: "healthy", fileVersions: canonical, manifestDigest: createHash("sha256").update(JSON.stringify(canonical)).digest("hex"), createdAt: now });
  await db().runTransaction(async (transaction) => {
    const current = await transaction.get(connectionRef);
    if (!current.exists || current.get("revision") !== expectedRevision || current.get("revokedAt")) throw new Error("stale or revoked library connection");
    const snapshotRef = connectionRef.collection("snapshots").doc(snapshotId);
    transaction.create(snapshotRef, snapshot);
    transaction.update(connectionRef, { currentHealthySnapshotId: snapshotId, lastSyncStatus: "healthy", retryCount: 0, nextEligibleRetryAt: FieldValue.delete(), revision: expectedRevision + 1, updatedAt: now });
  });
  return snapshot;
}

export async function failLibrarySync(connectionId: string, expectedRevision: number, failure: { category: "transient" | "reconnection_required" | "permanent"; retryCount: number; nextEligibleRetryAt?: string }): Promise<void> {
  const ref = root().doc(connectionId); const current = await ref.get();
  if (!current.exists || current.get("revision") !== expectedRevision) throw new Error("stale library connection");
  const lastSyncStatus = failure.category === "reconnection_required" ? "reconnection_required" : `${failure.category}_failure`;
  await ref.update({ lastSyncStatus, retryCount: failure.retryCount, nextEligibleRetryAt: failure.nextEligibleRetryAt ?? FieldValue.delete(), revision: expectedRevision + 1, updatedAt: new Date().toISOString() });
}

export async function finalizeLibrarySyncOperation(connectionId: string, operationId: string, status: "healthy" | "failed", failure?: { code: string; category: "transient" | "reconnection_required" | "permanent"; publicMessage: string; retryCount: number; nextEligibleRetryAt?: string }): Promise<void> { const now = new Date().toISOString(); await root().doc(connectionId).collection("sync_operations").doc(operationId).update({ status, completedAt: now, ...(failure ? { failure } : {}) }); }
