import type { Firestore, Transaction } from "@google-cloud/firestore";

import type { ArtifactRecord } from "./artifacts";
import type { ContextProjectionRecord } from "./contextProjections";
import { assertOperationFence, type OperationFence, type OperationRecord } from "./operations";
import { canonicalJson } from "./recordReplay/integrity";
import { currentTenant, tenantCollectionPath } from "./tenancy";

const OPERATIONS = "operations";
const ARTIFACTS = "artifacts";
const PROJECTIONS = "context_projections";

export interface ContextProjectionTransaction {
  getOperation(path: string): Promise<OperationRecord | null>;
  getArtifact(path: string): Promise<ArtifactRecord | null>;
  getProjection(path: string): Promise<ContextProjectionRecord | null>;
  createProjection(path: string, record: ContextProjectionRecord): void;
  setOperation(path: string, record: OperationRecord): void;
}

export interface ContextProjectionPersistence {
  transact<T>(work: (tx: ContextProjectionTransaction) => Promise<T>): Promise<T>;
}

function path(collection: string, id: string): string {
  if (!/^[A-Za-z0-9:_-]{1,512}$/.test(id)) throw new Error(`invalid ${collection} document id`);
  return `${tenantCollectionPath(currentTenant(), collection)}/${id}`;
}

function assertTenant(resource: { workspaceId: string; brandId: string }): void {
  const tenant = currentTenant();
  if (resource.workspaceId !== tenant.workspaceId || resource.brandId !== tenant.brandId) {
    throw new Error("context projection tenant mismatch");
  }
}

export class ContextProjectionStore {
  constructor(private readonly persistence: ContextProjectionPersistence) {}

  async create(
    projection: ContextProjectionRecord,
    fence: OperationFence,
  ): Promise<{ created: boolean; projection: ContextProjectionRecord }> {
    assertTenant(projection);
    if (projection.operationId !== fence.operationId || projection.operationEpoch !== fence.epoch) {
      throw new Error("projection operation fence mismatch");
    }
    const operationPath = path(OPERATIONS, projection.operationId);
    const artifactPath = path(ARTIFACTS, projection.renderedArtifactId);
    const projectionPath = path(PROJECTIONS, projection.id);
    return this.persistence.transact(async (transaction) => {
      const [operation, artifact, existing] = await Promise.all([
        transaction.getOperation(operationPath),
        transaction.getArtifact(artifactPath),
        transaction.getProjection(projectionPath),
      ]);
      if (!operation) throw new Error("projection operation not found");
      assertTenant(operation);
      assertOperationFence(operation, fence);
      if (operation.goal.digest !== projection.goalDigest) {
        throw new Error("projection goal digest mismatch");
      }
      if (!artifact) throw new Error("rendered context artifact not found");
      assertTenant(artifact);
      if (artifact.state !== "ready") throw new Error(`rendered context artifact is ${artifact.state}`);
      if (artifact.operationId !== projection.operationId) throw new Error("rendered artifact operation mismatch");
      if (artifact.sha256 !== projection.renderedDigest) throw new Error("rendered artifact digest mismatch");
      if (existing) {
        if (canonicalJson(existing) !== canonicalJson(projection)) {
          throw new Error("context projection identity conflict");
        }
        return { created: false, projection: existing };
      }
      transaction.createProjection(projectionPath, projection);
      transaction.setOperation(operationPath, {
        ...operation,
        latestProjectionId: projection.id,
        updatedAt: fence.now,
      });
      return { created: true, projection };
    });
  }
}

function adapter(transaction: Transaction, database: Firestore): ContextProjectionTransaction {
  async function get<T>(documentPath: string): Promise<T | null> {
    const snapshot = await transaction.get(database.doc(documentPath));
    return snapshot.exists ? snapshot.data() as T : null;
  }
  return {
    getOperation: (documentPath) => get<OperationRecord>(documentPath),
    getArtifact: (documentPath) => get<ArtifactRecord>(documentPath),
    getProjection: (documentPath) => get<ContextProjectionRecord>(documentPath),
    createProjection: (documentPath, record) => transaction.create(database.doc(documentPath), record),
    setOperation: (documentPath, record) => transaction.set(database.doc(documentPath), record),
  };
}

export class FirestoreContextProjectionPersistence implements ContextProjectionPersistence {
  constructor(private readonly database: Firestore) {}
  transact<T>(work: (tx: ContextProjectionTransaction) => Promise<T>): Promise<T> {
    return this.database.runTransaction((transaction) => work(adapter(transaction, this.database)));
  }
}

export function createContextProjectionStore(database: Firestore): ContextProjectionStore {
  return new ContextProjectionStore(new FirestoreContextProjectionPersistence(database));
}
