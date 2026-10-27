import type { Firestore } from "@google-cloud/firestore";

import {
  claimEventInbox,
  completeEventInbox,
  eventInboxKey,
  type EventInboxClaimInput,
  type EventInboxClaimResult,
  type EventInboxRecord,
} from "./eventInbox";
import {
  assertOperationFence,
  createOperation,
  finalizeOperation,
  type CreateOperationInput,
  type OperationRecord,
} from "./operations";
import { currentTenant, tenantCollectionPath } from "./tenancy";

const EVENT_INBOX = "event_inbox";
const OPERATIONS = "operations";

export type DurableEventClaimInput = EventInboxClaimInput & { operation: CreateOperationInput };

function assertTenant(resource: { workspaceId: string; brandId: string }): void {
  const tenant = currentTenant();
  if (resource.workspaceId !== tenant.workspaceId || resource.brandId !== tenant.brandId) {
    throw new Error("event inbox tenant mismatch");
  }
}

function assertOperationIntent(existing: OperationRecord, expected: OperationRecord): void {
  if (
    existing.id !== expected.id
    || existing.workspaceId !== expected.workspaceId
    || existing.brandId !== expected.brandId
    || existing.jobId !== expected.jobId
    || existing.kind !== expected.kind
    || existing.goal.digest !== expected.goal.digest
    || existing.correlationId !== expected.correlationId
    || existing.replayPolicy !== expected.replayPolicy
  ) {
    throw new Error("event operation identity conflict");
  }
}

export class EventInboxStore {
  constructor(private readonly database: Firestore) {}

  private inboxPath(source: string, sourceEventId: string): string {
    return `${tenantCollectionPath(currentTenant(), EVENT_INBOX)}/${eventInboxKey(source, sourceEventId)}`;
  }

  private operationPath(operationId: string): string {
    if (!/^[A-Za-z0-9:_-]{1,512}$/.test(operationId)) throw new Error("invalid operation document id");
    return `${tenantCollectionPath(currentTenant(), OPERATIONS)}/${operationId}`;
  }

  async claim(input: DurableEventClaimInput): Promise<EventInboxClaimResult> {
    assertTenant(input.envelope);
    const expectedOperation = createOperation(input.operation);
    assertTenant(expectedOperation);
    if (input.envelope.operationId !== expectedOperation.id) {
      throw new Error("event operation id mismatch");
    }
    if (input.envelope.correlationId !== expectedOperation.correlationId) {
      throw new Error("event operation correlation mismatch");
    }
    if (input.replayPolicy !== expectedOperation.replayPolicy) {
      throw new Error("event operation replay policy mismatch");
    }

    const inboxRef = this.database.doc(this.inboxPath(input.envelope.source, input.envelope.sourceEventId));
    const operationRef = this.database.doc(this.operationPath(expectedOperation.id));
    return this.database.runTransaction(async (transaction) => {
      const [inboxSnapshot, operationSnapshot] = await Promise.all([
        transaction.get(inboxRef),
        transaction.get(operationRef),
      ]);
      const existingInbox = inboxSnapshot.exists ? inboxSnapshot.data() as EventInboxRecord : null;
      const result = claimEventInbox(existingInbox, input);
      if (!operationSnapshot.exists) {
        transaction.create(operationRef, expectedOperation);
      } else {
        const existingOperation = operationSnapshot.data() as OperationRecord;
        assertTenant(existingOperation);
        assertOperationIntent(existingOperation, expectedOperation);
      }
      if (!inboxSnapshot.exists) transaction.create(inboxRef, result.record);
      else if (result.record !== existingInbox) transaction.set(inboxRef, result.record);
      return result;
    });
  }

  async get(source: string, sourceEventId: string): Promise<EventInboxRecord | null> {
    const snapshot = await this.database.doc(this.inboxPath(source, sourceEventId)).get();
    if (!snapshot.exists) return null;
    const record = snapshot.data() as EventInboxRecord;
    assertTenant(record);
    return record;
  }

  async complete(
    source: string,
    sourceEventId: string,
    input: {
      ownerTokenDigest: string;
      outcome: "completed" | "rejected";
      now: string;
      rejectionReason?: string;
      operationId: string;
      operationEpoch: number;
      operationState: "unknown" | "succeeded" | "failed" | "cancelled";
      operationReason?: string;
    },
  ): Promise<EventInboxRecord> {
    const ref = this.database.doc(this.inboxPath(source, sourceEventId));
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(ref);
      if (!snapshot.exists) throw new Error("event inbox record not found");
      const current = snapshot.data() as EventInboxRecord;
      assertTenant(current);
      if (current.operationId !== input.operationId) throw new Error("event operation id mismatch");
      const operationRef = this.database.doc(this.operationPath(current.operationId));
      const operationSnapshot = await transaction.get(operationRef);
      if (!operationSnapshot.exists) throw new Error("event operation not found");
      const operation = operationSnapshot.data() as OperationRecord;
      assertTenant(operation);
      const tenant = currentTenant();
      assertOperationFence(operation, {
        operationId: input.operationId,
        workspaceId: tenant.workspaceId,
        brandId: tenant.brandId,
        epoch: input.operationEpoch,
        now: input.now,
      });
      const completed = completeEventInbox(current, input.ownerTokenDigest, input);
      const finalizedOperation = finalizeOperation(operation, {
        epoch: input.operationEpoch,
        state: input.operationState,
        now: input.now,
        ...(input.operationReason ? { unresolvedReason: input.operationReason } : {}),
      });
      transaction.set(ref, completed);
      transaction.set(operationRef, finalizedOperation);
      return completed;
    });
  }
}
