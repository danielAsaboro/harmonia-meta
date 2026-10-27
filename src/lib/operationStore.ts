import type { Firestore, Transaction } from "@google-cloud/firestore";

import {
  assertOperationFence,
  claimOperation,
  createOperation,
  finalizeOperation,
  type CreateOperationInput,
  type FinalizeOperationInput,
  type OperationClaimInput,
  type OperationClaimResult,
  type OperationFence,
  type OperationRecord,
} from "./operations";
import { currentTenant, tenantCollectionPath, type TenantScope } from "./tenancy";

const OPERATIONS = "operations";
const OPERATION_DOCUMENT_ID = /^[A-Za-z0-9:_-]{1,512}$/;

export interface OperationPersistenceTransaction {
  get(path: string): Promise<OperationRecord | null>;
  create(path: string, operation: OperationRecord): void;
  set(path: string, operation: OperationRecord): void;
}

export interface OperationPersistence {
  transact<T>(work: (tx: OperationPersistenceTransaction) => Promise<T>): Promise<T>;
  get(path: string): Promise<OperationRecord | null>;
  listExpired(
    collectionPath: string,
    now: string,
    limit: number,
    cursor?: OperationRecoveryCursor,
  ): Promise<OperationRecord[]>;
}

export interface OperationRecoveryCursor {
  leaseExpiresAt: string;
  id: string;
}

export interface OperationRecoveryPage {
  items: OperationRecord[];
  nextCursor?: OperationRecoveryCursor;
}

function assertCurrentTenant(operation: Pick<OperationRecord, "workspaceId" | "brandId">): void {
  const tenant = currentTenant();
  if (operation.workspaceId !== tenant.workspaceId || operation.brandId !== tenant.brandId) {
    throw new Error("operation tenant mismatch");
  }
}

function immutableIdentity(operation: OperationRecord): string {
  return JSON.stringify({
    id: operation.id,
    workspaceId: operation.workspaceId,
    brandId: operation.brandId,
    jobId: operation.jobId,
    kind: operation.kind,
    goal: operation.goal,
    causalParentId: operation.causalParentId ?? null,
    correlationId: operation.correlationId,
    replayPolicy: operation.replayPolicy,
    maxAttempts: operation.maxAttempts,
    budget: operation.budget,
  });
}

export function operationDocumentPath(scope: TenantScope, operationId: string): string {
  if (!OPERATION_DOCUMENT_ID.test(operationId)) throw new Error("invalid operation document id");
  return `${tenantCollectionPath(scope, OPERATIONS)}/${operationId}`;
}

export class OperationStore {
  constructor(private readonly persistence: OperationPersistence) {}

  async create(input: CreateOperationInput): Promise<{ created: boolean; operation: OperationRecord }> {
    const operation = createOperation(input);
    assertCurrentTenant(operation);
    const path = operationDocumentPath(currentTenant(), operation.id);
    return this.persistence.transact(async (tx) => {
      const existing = await tx.get(path);
      if (existing) {
        assertCurrentTenant(existing);
        if (immutableIdentity(existing) !== immutableIdentity(operation)) {
          throw new Error("operation identity conflict");
        }
        return { created: false, operation: existing };
      }
      tx.create(path, operation);
      return { created: true, operation };
    });
  }

  async get(operationId: string): Promise<OperationRecord | null> {
    const record = await this.persistence.get(operationDocumentPath(currentTenant(), operationId));
    if (record) assertCurrentTenant(record);
    return record;
  }

  async claim(operationId: string, input: OperationClaimInput): Promise<OperationClaimResult> {
    const path = operationDocumentPath(currentTenant(), operationId);
    return this.persistence.transact(async (tx) => {
      const existing = await tx.get(path);
      if (!existing) throw new Error("operation not found");
      assertCurrentTenant(existing);
      const result = claimOperation(existing, input);
      if (result.operation !== existing) tx.set(path, result.operation);
      return result;
    });
  }

  async assertFence(fence: OperationFence): Promise<OperationRecord> {
    const path = operationDocumentPath(currentTenant(), fence.operationId);
    const operation = await this.persistence.get(path);
    if (!operation) throw new Error("operation not found");
    assertCurrentTenant(operation);
    assertOperationFence(operation, fence);
    return operation;
  }

  async finalize(operationId: string, input: FinalizeOperationInput): Promise<OperationRecord> {
    const path = operationDocumentPath(currentTenant(), operationId);
    return this.persistence.transact(async (tx) => {
      const existing = await tx.get(path);
      if (!existing) throw new Error("operation not found");
      assertCurrentTenant(existing);
      const tenant = currentTenant();
      assertOperationFence(existing, {
        operationId,
        workspaceId: tenant.workspaceId,
        brandId: tenant.brandId,
        epoch: input.epoch,
        now: input.now,
      });
      const finalized = finalizeOperation(existing, input);
      tx.set(path, finalized);
      return finalized;
    });
  }

  async listRecoveryCandidates(input: {
    now: string;
    limit: number;
    cursor?: OperationRecoveryCursor;
  }): Promise<OperationRecoveryPage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error("operation recovery limit must be between 1 and 100");
    }
    if (!Number.isFinite(Date.parse(input.now))) throw new Error("invalid recovery timestamp");
    const items = await this.persistence.listExpired(
      tenantCollectionPath(currentTenant(), OPERATIONS),
      input.now,
      input.limit,
      input.cursor,
    );
    for (const operation of items) assertCurrentTenant(operation);
    const last = items.at(-1);
    return {
      items,
      ...(last?.leaseExpiresAt
        ? { nextCursor: { leaseExpiresAt: last.leaseExpiresAt, id: last.id } }
        : {}),
    };
  }
}

function firestoreTransactionAdapter(transaction: Transaction, database: Firestore): OperationPersistenceTransaction {
  return {
    get: async (path) => {
      const snapshot = await transaction.get(database.doc(path));
      return snapshot.exists ? snapshot.data() as OperationRecord : null;
    },
    create: (path, operation) => transaction.create(database.doc(path), operation),
    set: (path, operation) => transaction.set(database.doc(path), operation),
  };
}

export class FirestoreOperationPersistence implements OperationPersistence {
  constructor(private readonly database: Firestore) {}

  transact<T>(work: (tx: OperationPersistenceTransaction) => Promise<T>): Promise<T> {
    return this.database.runTransaction((transaction) => work(
      firestoreTransactionAdapter(transaction, this.database),
    ));
  }

  async get(path: string): Promise<OperationRecord | null> {
    const snapshot = await this.database.doc(path).get();
    return snapshot.exists ? snapshot.data() as OperationRecord : null;
  }

  async listExpired(
    collectionPath: string,
    now: string,
    limit: number,
    cursor?: OperationRecoveryCursor,
  ): Promise<OperationRecord[]> {
    let query = this.database.collection(collectionPath)
      .where("state", "==", "claimed")
      .where("leaseExpiresAt", "<=", now)
      .orderBy("leaseExpiresAt", "asc")
      .orderBy("id", "asc")
      .limit(limit);
    if (cursor) query = query.startAfter(cursor.leaseExpiresAt, cursor.id);
    const snapshot = await query.get();
    return snapshot.docs.map((document) => document.data() as OperationRecord);
  }
}
