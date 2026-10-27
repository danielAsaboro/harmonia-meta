import { createHash } from "node:crypto";
import { FieldPath, Timestamp, type QueryDocumentSnapshot } from "@google-cloud/firestore";
import { db } from "@/lib/firestore";
import { currentTenant, tenantCollectionPath } from "@/lib/tenancy";
import {
  agentActivitySchema,
  type AgentActivity,
  type AgentActivityData,
  type ObservabilityPage,
  type ObservabilityQuery,
  durableRuntimeSnapshotSchema,
  type DurableRuntimeSnapshot,
} from "./schema";

const COLLECTION = "agent_activity";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const SCAN_CHUNK = 100;
const MAX_SCAN = 1_000;

interface ActivityCursor {
  occurredAt: string;
  id: string;
}

function collection() {
  return db().collection(tenantCollectionPath(currentTenant(), COLLECTION));
}

export function encodeActivityCursor(cursor: ActivityCursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeActivityCursor(value: string): ActivityCursor {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object") throw new Error();
    const record = parsed as Record<string, unknown>;
    if (typeof record.occurredAt !== "string" || Number.isNaN(Date.parse(record.occurredAt))) throw new Error();
    if (typeof record.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(record.id)) throw new Error();
    return { occurredAt: new Date(record.occurredAt).toISOString(), id: record.id };
  } catch {
    throw new Error("invalid observability cursor");
  }
}

export function matchesActivityFilters(item: AgentActivity, filters: Partial<ObservabilityQuery>): boolean {
  if (filters.types?.length && !filters.types.includes(item.signalType)) return false;
  for (const key of ["agent", "stage", "outcome", "severity", "model", "tool", "jobId", "traceId"] as const) {
    if (filters[key] && item[key] !== filters[key]) return false;
  }
  const occurred = Date.parse(item.occurredAt);
  if (filters.since && occurred < Date.parse(filters.since)) return false;
  if (filters.until && occurred > Date.parse(filters.until)) return false;
  if (filters.q) {
    const needle = filters.q.toLowerCase();
    const haystack = [
      item.eventName, item.agent, item.stage, item.workflow, item.model, item.tool,
      item.jobId, item.invocationId, item.operationId, item.traceId, item.errorCategory,
      item.errorType,
    ].filter(Boolean).join(" ").toLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

export async function writeAgentActivity(input: AgentActivityData): Promise<{ id: string; duplicate: boolean }> {
  const tenant = currentTenant();
  if (input.workspaceId !== tenant.workspaceId || input.brandId !== tenant.brandId) {
    throw new Error("activity tenant mismatch");
  }
  const parsed = agentActivitySchema.parse(input);
  const id = `activity_${createHash("sha256").update([
    parsed.invocationId, parsed.signalType, parsed.eventName, parsed.traceId,
    parsed.spanId, parsed.occurredAt,
  ].join("|")).digest("hex").slice(0, 32)}`;
  const ref = collection().doc(id);
  const snapshot = await ref.get();
  if (snapshot.exists) return { id, duplicate: true };
  await ref.create({
    ...parsed,
    occurredAt: Timestamp.fromDate(new Date(parsed.occurredAt)),
    retentionDeleteAfter: Timestamp.fromMillis(Date.now() + RETENTION_MS),
  });
  return { id, duplicate: false };
}

function fromSnapshot(snapshot: QueryDocumentSnapshot): AgentActivity {
  const raw = snapshot.data() as Record<string, unknown>;
  const occurred = raw.occurredAt;
  const occurredAt = occurred instanceof Timestamp
    ? occurred.toDate().toISOString()
    : new Date(String(occurred)).toISOString();
  const { retentionDeleteAfter: _retentionDeleteAfter, ...activity } = raw;
  const parsed = agentActivitySchema.parse({ ...activity, occurredAt });
  return { id: snapshot.id, ...parsed };
}

function facets(items: AgentActivity[]): ObservabilityPage["facets"] {
  const values = (key: "agent" | "stage" | "model" | "tool") =>
    [...new Set(items.map((item) => item[key]).filter((value): value is string => Boolean(value)))].sort();
  return { agents: values("agent"), stages: values("stage"), models: values("model"), tools: values("tool") };
}

export async function listAgentActivity(filters: ObservabilityQuery): Promise<ObservabilityPage> {
  let query = collection().orderBy("occurredAt", "desc").orderBy(FieldPath.documentId(), "desc");
  if (filters.cursor) {
    const cursor = decodeActivityCursor(filters.cursor);
    query = query.startAfter(Timestamp.fromDate(new Date(cursor.occurredAt)), cursor.id);
  }
  const matched: Array<{ item: AgentActivity; cursor: ActivityCursor }> = [];
  let scanned = 0;
  let lastScanned: ActivityCursor | null = null;
  let exhausted = false;
  while (matched.length <= filters.limit && scanned < MAX_SCAN && !exhausted) {
    const snapshot = await query.limit(SCAN_CHUNK).get();
    if (snapshot.empty) break;
    for (const doc of snapshot.docs) {
      const item = fromSnapshot(doc);
      const cursor = { occurredAt: item.occurredAt, id: item.id };
      lastScanned = cursor;
      scanned += 1;
      if (matchesActivityFilters(item, filters)) matched.push({ item, cursor });
      if (matched.length > filters.limit || scanned >= MAX_SCAN) break;
    }
    exhausted = snapshot.size < SCAN_CHUNK;
    if (!lastScanned || matched.length > filters.limit || scanned >= MAX_SCAN) break;
    query = collection()
      .orderBy("occurredAt", "desc")
      .orderBy(FieldPath.documentId(), "desc")
      .startAfter(Timestamp.fromDate(new Date(lastScanned.occurredAt)), lastScanned.id);
  }
  const hasMore = matched.length > filters.limit || (!exhausted && scanned >= MAX_SCAN);
  const visible = matched.slice(0, filters.limit);
  const cursorSource = matched.length > filters.limit
    ? visible.at(-1)?.cursor
    : hasMore ? lastScanned : null;
  const items = visible.map(({ item }) => item);
  return {
    items,
    nextCursor: cursorSource ? encodeActivityCursor(cursorSource) : null,
    hasMore,
    facets: facets(items),
  };
}

export function oldestLagSeconds(timestamps: string[], now = new Date().toISOString()): number {
  if (!timestamps.length) return 0;
  const nowMs = Date.parse(now);
  if (!Number.isFinite(nowMs)) throw new Error("invalid runtime snapshot timestamp");
  const valid = timestamps.map(Date.parse).filter(Number.isFinite);
  if (!valid.length) return 0;
  return Math.max(0, Math.min(30 * 24 * 60 * 60, Math.floor((nowMs - Math.min(...valid)) / 1000)));
}

export async function getDurableRuntimeSnapshot(now = new Date().toISOString()): Promise<DurableRuntimeSnapshot> {
  const tenant = currentTenant();
  const tenantCollection = (name: string) => db().collection(tenantCollectionPath(tenant, name));
  const [operations, inbox, outbox, unknown, observed, projections, artifacts, recovery] = await Promise.all([
    tenantCollection("operations").where("state", "==", "claimed").limit(100).get(),
    tenantCollection("event_inbox").where("state", "==", "processing").limit(100).get(),
    tenantCollection("stage_outbox").where("state", "==", "claimed").limit(100).get(),
    tenantCollection("effect_commands").where("state", "==", "unknown").limit(100).get(),
    tenantCollection("effect_commands").where("state", "==", "observed").limit(100).get(),
    tenantCollection("context_projections").orderBy("createdAt", "desc").limit(100).get(),
    tenantCollection("artifacts").limit(100).get(),
    tenantCollection("recovery_work").orderBy("createdAt", "desc").limit(100).get(),
  ]);
  const nowMs = Date.parse(now);
  const staleOperations = operations.docs.filter((doc) => Date.parse(String(doc.get("leaseExpiresAt") ?? "")) <= nowMs);
  const staleInbox = inbox.docs.filter((doc) => Date.parse(String(doc.get("claimUntil") ?? "")) <= nowMs);
  const staleOutbox = outbox.docs.filter((doc) => Date.parse(String(doc.get("claimUntil") ?? "")) <= nowMs);
  const latestProjection = projections.docs[0];
  const artifactStates = artifacts.docs.map((doc) => String(doc.get("state")));
  return durableRuntimeSnapshotSchema.parse({
    generatedAt: now,
    staleLeases: { operations: staleOperations.length, inbox: staleInbox.length, outbox: staleOutbox.length },
    inboxLagSeconds: oldestLagSeconds(inbox.docs.map((doc) => String(doc.get("receivedAt") ?? doc.get("updatedAt") ?? now)), now),
    outboxLagSeconds: oldestLagSeconds(outbox.docs.map((doc) => String(doc.get("createdAt") ?? now)), now),
    unknownEffects: unknown.docs.map((doc) => ({
      jobId: String(doc.get("jobId")), operationId: String(doc.get("operationId")), commandId: doc.id,
      epoch: Number(doc.get("operationEpoch")), reason: String(doc.get("unknownReason") ?? "provider outcome unknown"),
      ...(doc.get("dispatchedAt") ? { dispatchedAt: String(doc.get("dispatchedAt")) } : {}),
    })),
    observedEffects: observed.size,
    projection: {
      count: projections.size,
      compilerVersion: latestProjection ? String(latestProjection.get("compilerVersion")) : null,
      manifestDigest: latestProjection ? String(latestProjection.get("manifestDigest")) : null,
    },
    artifacts: {
      ready: artifactStates.filter((state) => state === "ready").length,
      writing: artifactStates.filter((state) => state === "writing").length,
      failed: artifactStates.filter((state) => state === "failed").length,
    },
    recovery: {
      pending: recovery.docs.filter((doc) => doc.get("state") === "pending").length,
      recentActions: recovery.docs.map((doc) => String(doc.get("action"))).filter(Boolean),
    },
  });
}
