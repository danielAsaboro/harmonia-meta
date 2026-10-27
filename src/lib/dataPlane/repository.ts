import { FieldValue, type Firestore } from "@google-cloud/firestore";

import { assertResourceWorkspace, currentTenant, tenantDocumentPath } from "../tenancy";
import { dataBatchSchema, dataWorkItemSchema, type DataBatch, type DataWorkItem } from "./contracts";
import { reduceBatchOutcome, type BatchOutcome } from "./fanIn";
import {
  claimWorkItem,
  finalizeWorkItem,
  type WorkItemClaimInput,
  type WorkItemClaimResult,
  type WorkItemFinalizeInput,
  selectDispatchableItems,
} from "./workItems";

export class DataPlaneRepository {
  constructor(private readonly firestore: Firestore) {}

  private batchRef(batchId: string) {
    return this.firestore.doc(tenantDocumentPath(currentTenant(), "data_batches", batchId));
  }

  async create(batchInput: DataBatch, workInput: DataWorkItem[]): Promise<void> {
    const tenant = currentTenant();
    const batch = dataBatchSchema.parse(batchInput);
    assertResourceWorkspace(tenant, batch);
    const work = workInput.map((item) => dataWorkItemSchema.parse(item));
    if (work.length !== batch.manifest.itemCount) throw new Error("batch manifest item count does not match work items");
    const ids = new Set<string>();
    for (const item of work) {
      assertResourceWorkspace(tenant, item);
      if (item.batchId !== batch.id || item.processorVersion !== batch.processorVersion || item.maxAttempts !== batch.maxAttempts) {
        throw new Error("work item does not match batch policy");
      }
      if (ids.has(item.id)) throw new Error("duplicate work item id");
      ids.add(item.id);
    }
    const batchRef = this.batchRef(batch.id);
    await this.firestore.runTransaction(async (transaction) => {
      const existing = await transaction.get(batchRef);
      if (existing.exists) {
        const stored = dataBatchSchema.parse(existing.data());
        if (stored.state !== "initializing" && !(stored.state === "failed" && stored.failureCode === "initialization_incomplete")) {
          throw new Error("data batch already exists");
        }
        if (stored.manifest.sha256 !== batch.manifest.sha256 || stored.processorVersion !== batch.processorVersion) {
          throw new Error("data batch initialization identity mismatch");
        }
        transaction.set(batchRef, { ...batch, state: "initializing", failureCode: FieldValue.delete() });
      } else {
        transaction.create(batchRef, { ...batch, state: "initializing" });
      }
    });
    try {
      for (let offset = 0; offset < work.length; offset += 400) {
        const writer = this.firestore.batch();
        for (const item of work.slice(offset, offset + 400)) writer.set(batchRef.collection("work_items").doc(item.id), item);
        await writer.commit();
      }
      await batchRef.update({ state: "pending", updatedAt: new Date().toISOString() });
    } catch (error) {
      await batchRef.update({ state: "failed", failureCode: "initialization_incomplete", updatedAt: new Date().toISOString() });
      throw error;
    }
  }

  async claim(batchId: string, itemId: string, input: WorkItemClaimInput): Promise<WorkItemClaimResult> {
    const batchRef = this.batchRef(batchId);
    const itemRef = batchRef.collection("work_items").doc(itemId);
    return this.firestore.runTransaction(async (transaction) => {
      const [batchSnap, itemSnap] = await Promise.all([transaction.get(batchRef), transaction.get(itemRef)]);
      if (!batchSnap.exists || !itemSnap.exists) throw new Error("data-plane aggregate not found");
      const batch = dataBatchSchema.parse(batchSnap.data());
      const item = dataWorkItemSchema.parse(itemSnap.data());
      assertResourceWorkspace(currentTenant(), batch);
      assertResourceWorkspace(currentTenant(), item);
      if (batch.state === "cancelled") return { outcome: "cancelled", item: { ...item, state: "cancelled" } };
      const result = claimWorkItem(item, input);
      if (result.item !== item) transaction.set(itemRef, result.item);
      if (result.outcome === "execute" && batch.state === "pending") transaction.update(batchRef, { state: "running", updatedAt: input.now });
      return result;
    });
  }

  async finalize(batchId: string, itemId: string, input: WorkItemFinalizeInput): Promise<DataWorkItem> {
    const batchRef = this.batchRef(batchId);
    const itemRef = batchRef.collection("work_items").doc(itemId);
    return this.firestore.runTransaction(async (transaction) => {
      const [batchSnapshot, snapshot, itemSnapshots] = await Promise.all([
        transaction.get(batchRef), transaction.get(itemRef), transaction.get(batchRef.collection("work_items")),
      ]);
      if (!batchSnapshot.exists || !snapshot.exists) throw new Error("data work item not found");
      const batch = dataBatchSchema.parse(batchSnapshot.data());
      const current = dataWorkItemSchema.parse(snapshot.data());
      assertResourceWorkspace(currentTenant(), current);
      const finalized = finalizeWorkItem(current, input);
      transaction.set(itemRef, finalized);
      const items = itemSnapshots.docs.map((doc) => doc.id === itemId ? finalized : dataWorkItemSchema.parse(doc.data()));
      const result = reduceBatchOutcome(items, batch);
      transaction.update(batchRef, { state: result.outcome, updatedAt: input.now });
      return finalized;
    });
  }

  async outcome(batchId: string): Promise<BatchOutcome> {
    const batchRef = this.batchRef(batchId);
    const [batchSnapshot, itemSnapshots] = await Promise.all([batchRef.get(), batchRef.collection("work_items").get()]);
    if (!batchSnapshot.exists) throw new Error("data batch not found");
    const batch = dataBatchSchema.parse(batchSnapshot.data());
    assertResourceWorkspace(currentTenant(), batch);
    return reduceBatchOutcome(itemSnapshots.docs.map((doc) => dataWorkItemSchema.parse(doc.data())), batch);
  }

  async dispatchable(batchId: string, now: string): Promise<{ batch: DataBatch; items: DataWorkItem[] }> {
    const batchRef = this.batchRef(batchId);
    const [batchSnapshot, itemSnapshots] = await Promise.all([batchRef.get(), batchRef.collection("work_items").get()]);
    if (!batchSnapshot.exists) throw new Error("data batch not found");
    const batch = dataBatchSchema.parse(batchSnapshot.data());
    assertResourceWorkspace(currentTenant(), batch);
    if (!["pending", "running"].includes(batch.state)) return { batch, items: [] };
    const items = itemSnapshots.docs.map((doc) => dataWorkItemSchema.parse(doc.data()));
    return { batch, items: selectDispatchableItems(items, { now, maxInFlight: batch.maxInFlight }) };
  }

  async markDispatched(batchId: string, itemId: string, dispatchedAt: string): Promise<void> {
    if (!Number.isFinite(Date.parse(dispatchedAt))) throw new Error("invalid data work dispatch time");
    const itemRef = this.batchRef(batchId).collection("work_items").doc(itemId);
    await this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(itemRef);
      if (!snapshot.exists) throw new Error("data work item not found");
      const item = dataWorkItemSchema.parse(snapshot.data());
      assertResourceWorkspace(currentTenant(), item);
      if (item.state !== "pending" && item.state !== "failed") return;
      transaction.update(itemRef, { lastDispatchedAt: dispatchedAt, dispatchCount: (item.dispatchCount ?? 0) + 1, updatedAt: dispatchedAt });
    });
  }
}
