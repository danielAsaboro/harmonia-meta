import type { Firestore } from "@google-cloud/firestore";

import { currentTenant, tenantDocumentPath } from "../tenancy";
import {
  parseOperationalUpdate,
  type OperationalUpdate,
  type UnsequencedOperationalUpdate,
} from "./updateFeed";
import type { AttentionItem } from "./attention";
import type { JobShell } from "./jobShell";
import { canonicalJson } from "../recordReplay/integrity";

const FEEDS = "operational_feeds";
const MAX_EVENTS_PER_SYNC = 400;

export class OperationalUpdateFeedStore {
  constructor(private readonly firestore: Firestore) {}

  private feedRef() {
    const tenant = currentTenant();
    return this.firestore.doc(tenantDocumentPath(tenant, FEEDS, tenant.brandId));
  }

  async append(input: UnsequencedOperationalUpdate): Promise<OperationalUpdate> {
    const tenant = currentTenant();
    const feedRef = this.feedRef();
    return this.firestore.runTransaction(async (transaction) => {
      const feed = await transaction.get(feedRef);
      const previous = feed.exists ? Number(feed.get("lastSequence")) : -1;
      if (!Number.isInteger(previous) || previous < -1) throw new Error("operational feed head is invalid");
      const sequence = previous + 1;
      const event = parseOperationalUpdate({ ...input, sequence });
      const updateRef = feedRef.collection("updates").doc(String(sequence).padStart(16, "0"));
      transaction.create(updateRef, { ...event, workspaceId: tenant.workspaceId, brandId: tenant.brandId });
      transaction.set(feedRef, {
        workspaceId: tenant.workspaceId,
        brandId: tenant.brandId,
        lastSequence: sequence,
        updatedAt: event.occurredAt,
      }, { merge: true });
      return event;
    });
  }

  async headSequence(): Promise<number> {
    const snapshot = await this.feedRef().get();
    if (!snapshot.exists) return -1;
    const value = Number(snapshot.get("lastSequence"));
    if (!Number.isInteger(value) || value < -1) throw new Error("operational feed head is invalid");
    return value;
  }

  async synchronize(input: {
    jobs: JobShell[];
    attention: AttentionItem[];
    occurredAt: string;
  }): Promise<OperationalUpdate[]> {
    const tenant = currentTenant();
    const feedRef = this.feedRef();
    return this.firestore.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(feedRef);
      const previousSequence = snapshot.exists ? Number(snapshot.get("lastSequence")) : -1;
      if (!Number.isInteger(previousSequence) || previousSequence < -1) throw new Error("operational feed head is invalid");
      const priorJobs = snapshot.exists ? (snapshot.get("projectionJobs") ?? {}) as Record<string, JobShell> : {};
      const priorAttention = snapshot.exists ? (snapshot.get("projectionAttention") ?? {}) as Record<string, AttentionItem> : {};
      const jobs = Object.fromEntries(input.jobs.map((shell) => [shell.jobId, shell]));
      const attention = Object.fromEntries(input.attention.map((item) => [item.id, item]));
      const pending: UnsequencedOperationalUpdate[] = [];
      for (const id of Object.keys(priorJobs).sort()) if (!jobs[id]) pending.push({ type: "job_shell_removed", occurredAt: input.occurredAt, jobId: id });
      for (const id of Object.keys(jobs).sort()) if (canonicalJson(priorJobs[id]) !== canonicalJson(jobs[id])) pending.push({ type: "job_shell_upserted", occurredAt: input.occurredAt, shell: jobs[id] });
      for (const id of Object.keys(priorAttention).sort()) if (!attention[id]) pending.push({ type: "attention_removed", occurredAt: input.occurredAt, attentionId: id });
      for (const id of Object.keys(attention).sort()) if (canonicalJson(priorAttention[id]) !== canonicalJson(attention[id])) pending.push({ type: "attention_upserted", occurredAt: input.occurredAt, item: attention[id] });

      const committed = pending.slice(0, MAX_EVENTS_PER_SYNC);
      const events = committed.map((event, index) => parseOperationalUpdate({ ...event, sequence: previousSequence + index + 1 }));
      const projectionJobs = { ...priorJobs };
      const projectionAttention = { ...priorAttention };
      for (const event of events) {
        if (event.type === "job_shell_upserted") projectionJobs[event.shell.jobId] = event.shell;
        if (event.type === "job_shell_removed") delete projectionJobs[event.jobId];
        if (event.type === "attention_upserted") projectionAttention[event.item.id] = event.item;
        if (event.type === "attention_removed") delete projectionAttention[event.attentionId];
        transaction.create(feedRef.collection("updates").doc(String(event.sequence).padStart(16, "0")), {
          ...event, workspaceId: tenant.workspaceId, brandId: tenant.brandId,
        });
      }
      transaction.set(feedRef, {
        workspaceId: tenant.workspaceId,
        brandId: tenant.brandId,
        lastSequence: previousSequence + events.length,
        updatedAt: input.occurredAt,
        projectionJobs,
        projectionAttention,
      }, { merge: true });
      return events;
    });
  }

  async listAfter(afterSequence: number, limit = 500): Promise<OperationalUpdate[]> {
    if (!Number.isInteger(afterSequence) || afterSequence < -1) throw new Error("afterSequence must be -1 or a non-negative integer");
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("operational update limit must be between 1 and 500");
    const snaps = await this.feedRef().collection("updates")
      .where("sequence", ">", afterSequence)
      .orderBy("sequence", "asc")
      .limit(limit)
      .get();
    const tenant = currentTenant();
    return snaps.docs.map((snapshot) => {
      const { workspaceId, brandId, ...event } = snapshot.data();
      if (workspaceId !== tenant.workspaceId || brandId !== tenant.brandId) {
        throw new Error("operational update tenant scope mismatch");
      }
      return parseOperationalUpdate(event);
    });
  }
}
