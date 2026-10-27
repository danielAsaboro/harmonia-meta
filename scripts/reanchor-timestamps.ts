import { pathToFileURL } from "node:url";

import { Firestore, Timestamp, type CollectionReference, type DocumentData, type DocumentReference } from "@google-cloud/firestore";

const DEFAULT_TARGET_ISO = "2026-08-27T00:00:00.000Z";
const SUPERSEDED_REASON = "superseded";

type MigrationStats = {
  scannedDocs: number;
  scannedTimestampValues: number;
  matchedTimestampValues: number;
  updatedDocs: number;
  updatedTimestampValues: number;
  neutralizedDocs: number;
  firstTimestampMs: number | null;
};

type TransformResult = {
  value: unknown;
  changed: boolean;
  touchedTimestampValues: number;
};

type ScriptArgs = {
  targetIso: string;
  targetEndIso?: string;
  dryRun: boolean;
  batchSize: number;
};

export type InertCollection =
  | "operations"
  | "event_inbox"
  | "stage_outbox"
  | "effect_commands"
  | "pending_operations"
  | "stage_executions"
  | "jobs"
  | "content_items"
  | "data_batches"
  | "work_items"
  | "autonomy_cycles"
  | "autonomy_agendas"
  | "autonomy_agenda_items"
  | "autonomy_experiments"
  | "autonomy_configuration_revisions"
  | "telegram_decision_nonces"
  | "telegram_strategy_prompts"
  | "cost_reservations";

const INERT_COLLECTIONS = new Set<InertCollection>([
  "operations",
  "event_inbox",
  "stage_outbox",
  "effect_commands",
  "pending_operations",
  "stage_executions",
  "jobs",
  "content_items",
  "data_batches",
  "work_items",
  "autonomy_cycles",
  "autonomy_agendas",
  "autonomy_agenda_items",
  "autonomy_experiments",
  "autonomy_configuration_revisions",
  "telegram_decision_nonces",
  "telegram_strategy_prompts",
  "cost_reservations",
]);

export function inertCollectionForPath(path: string): InertCollection | null {
  const segments = path.split("/").filter(Boolean);
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    if (i % 2 === 0 && INERT_COLLECTIONS.has(segments[i] as InertCollection)) {
      return segments[i] as InertCollection;
    }
  }
  return null;
}

export function makeDocumentInert(
  collection: InertCollection,
  doc: Record<string, unknown>,
  nowIso: string,
): { value: Record<string, unknown>; changed: boolean } {
  if (!isPlainRecord(doc)) return { value: doc, changed: false };
  const next = { ...doc };

  if (collection === "operations") {
    const state = typeof next.state === "string" ? next.state : "";
    if (state === "succeeded" || state === "failed" || state === "cancelled") return { value: doc, changed: false };
    next.state = "cancelled";
    next.updatedAt = nowIso;
    next.completedAt = nowIso;
    next.unresolvedReason = SUPERSEDED_REASON;
    delete next.ownerId;
    delete next.ownerTokenDigest;
    delete next.leaseExpiresAt;
    return { value: next, changed: true };
  }

  if (collection === "event_inbox") {
    const state = typeof next.state === "string" ? next.state : "";
    if (state === "completed" || state === "rejected") return { value: doc, changed: false };
    next.state = "rejected";
    next.updatedAt = nowIso;
    next.completedAt = nowIso;
    next.rejectionReason = SUPERSEDED_REASON;
    delete next.ownerTokenDigest;
    delete next.claimUntil;
    return { value: next, changed: true };
  }

  if (collection === "stage_outbox") {
    const state = typeof next.state === "string" ? next.state : "";
    if (state === "published") return { value: doc, changed: false };
    next.state = "published";
    next.updatedAt = nowIso;
    next.publishedAt = nowIso;
    delete next.claimTokenDigest;
    delete next.claimUntil;
    return { value: next, changed: true };
  }

  if (collection === "effect_commands") {
    const state = typeof next.state === "string" ? next.state : "";
    if (state === "applied" || state === "failed" || state === "cancelled") return { value: doc, changed: false };
    next.state = "cancelled";
    next.updatedAt = nowIso;
    next.invalidatedReason = SUPERSEDED_REASON;
    delete next.operationId;
    delete next.operationEpoch;
    delete next.dispatchAttempt;
    delete next.dispatchedAt;
    delete next.observedAt;
    delete next.observedOutcome;
    delete next.observation;
    delete next.observationDigest;
    delete next.unknownReason;
    return { value: next, changed: true };
  }

  if (collection === "pending_operations") {
    const state = typeof next.state === "string" ? next.state : "";
    if (state === "approved" || state === "rejected") return { value: doc, changed: false };
    if (state !== "pending") return { value: doc, changed: false };
    next.state = "rejected";
    next.decidedAt = nowIso;
    next.decidedByUserId = "system";
    return { value: next, changed: true };
  }

  if (collection === "stage_executions") {
    const state = typeof next.state === "string" ? next.state : "";
    if (state === "applied" || state === "failed") return { value: doc, changed: false };
    next.state = "failed";
    next.updatedAt = nowIso;
    next.finalizedAt = nowIso;
    next.failureReason = SUPERSEDED_REASON;
    return { value: next, changed: true };
  }

  if (collection === "jobs") {
    const status = typeof next.status === "string" ? next.status : "";
    if (status === "complete" || status === "failed") return { value: doc, changed: false };
    next.status = "failed";
    next.stage = "failed";
    next.controlState = "cancelled";
    next.updatedAt = nowIso;
    return { value: next, changed: true };
  }

  if (collection === "content_items") {
    const status = typeof next.status === "string" ? next.status : "";
    if (!["scheduled", "awaiting_final_review", "publishing"].includes(status)) return { value: doc, changed: false };
    next.status = "cancelled";
    next.updatedAt = nowIso;
    next.failureReason = SUPERSEDED_REASON;
    delete next.effectCommandId;
    return { value: next, changed: true };
  }

  if (collection === "data_batches") {
    const state = typeof next.state === "string" ? next.state : "";
    if (!["initializing", "pending", "running"].includes(state)) return { value: doc, changed: false };
    next.state = "cancelled";
    next.updatedAt = nowIso;
    next.failureCode = SUPERSEDED_REASON;
    return { value: next, changed: true };
  }

  if (collection === "work_items") {
    const state = typeof next.state === "string" ? next.state : "";
    if (!["pending", "claimed", "failed"].includes(state)) return { value: doc, changed: false };
    next.state = "cancelled";
    next.updatedAt = nowIso;
    next.finalizedAt = nowIso;
    next.failureCode = SUPERSEDED_REASON;
    delete next.ownerId;
    delete next.ownerTokenDigest;
    delete next.leaseExpiresAt;
    return { value: next, changed: true };
  }

  if (collection === "autonomy_cycles") {
    const state = typeof next.state === "string" ? next.state : "";
    if (!["scheduled", "claimed", "running"].includes(state)) return { value: doc, changed: false };
    next.state = "failed";
    next.finishedAt = nowIso;
    next.outcome = SUPERSEDED_REASON;
    delete next.leaseOwner;
    delete next.leaseTokenDigest;
    delete next.leaseExpiresAt;
    return { value: next, changed: true };
  }

  if (collection === "autonomy_agendas") {
    const state = typeof next.state === "string" ? next.state : "";
    if (state !== "scheduled" && state !== "active") return { value: doc, changed: false };
    next.state = "failed";
    return { value: next, changed: true };
  }

  if (collection === "autonomy_agenda_items") {
    const state = typeof next.state === "string" ? next.state : "";
    if (state !== "pending" && state !== "claimed") return { value: doc, changed: false };
    next.state = "failed";
    return { value: next, changed: true };
  }

  if (collection === "autonomy_experiments") {
    const state = typeof next.state === "string" ? next.state : "";
    if (!["candidate", "active", "evaluating"].includes(state)) return { value: doc, changed: false };
    next.state = "expired";
    return { value: next, changed: true };
  }

  if (collection === "autonomy_configuration_revisions") {
    if (next.state !== "proposed") return { value: doc, changed: false };
    next.state = "rejected";
    return { value: next, changed: true };
  }

  if (collection === "telegram_decision_nonces" || collection === "telegram_strategy_prompts") {
    if (next.state !== "pending" && next.state !== "processing") return { value: doc, changed: false };
    next.state = "consumed";
    next.decisionId = "expired";
    return { value: next, changed: true };
  }

  if (collection === "cost_reservations") {
    if (next.state !== "reserved") return { value: doc, changed: false };
    next.state = "uncertain";
    next.uncertainAt = nowIso;
    next.uncertainReason = SUPERSEDED_REASON;
    return { value: next, changed: true };
  }

  return { value: doc, changed: false };
}

const HISTORICAL_TRANSITION_KEYS = new Set([
  "updatedAt",
  "createdAt",
  "receivedAt",
  "claimedAt",
  "startedAt",
  "requestedAt",
]);

function historicalTransitionIso(doc: Record<string, unknown>, fallbackIso: string): string {
  let latestMs = Date.parse(fallbackIso);
  for (const [key, value] of Object.entries(doc)) {
    if (!HISTORICAL_TRANSITION_KEYS.has(key)) continue;
    const ms = timestampMsFromValue(value);
    if (ms !== null && ms > latestMs) latestMs = ms;
  }
  return new Date(latestMs).toISOString();
}

export function repairInertTimeline(
  collection: InertCollection,
  doc: Record<string, unknown>,
  fallbackIso: string,
): { value: Record<string, unknown>; changed: boolean } {
  const transitionIso = historicalTransitionIso(doc, fallbackIso);
  const transitionMs = Date.parse(transitionIso);
  const next = { ...doc };
  let changed = false;
  const setIfEarlier = (key: string): void => {
    const currentMs = timestampMsFromValue(next[key]);
    if (currentMs !== null && currentMs >= transitionMs) return;
    next[key] = transitionIso;
    changed = true;
  };

  if (collection === "jobs" && next.status === "failed" && next.stage === "failed" && next.controlState === "cancelled") {
    setIfEarlier("updatedAt");
  } else if (collection === "operations" && next.unresolvedReason === SUPERSEDED_REASON) {
    setIfEarlier("updatedAt");
    setIfEarlier("completedAt");
  } else if (collection === "event_inbox" && next.rejectionReason === SUPERSEDED_REASON) {
    setIfEarlier("updatedAt");
    setIfEarlier("completedAt");
  } else if (collection === "stage_outbox" && next.state === "published") {
    const createdMs = timestampMsFromValue(next.createdAt);
    const publishedMs = timestampMsFromValue(next.publishedAt);
    if (createdMs !== null && (publishedMs === null || publishedMs < createdMs)) setIfEarlier("publishedAt");
  } else if (collection === "effect_commands" && next.invalidatedReason === SUPERSEDED_REASON) {
    setIfEarlier("updatedAt");
  } else if (collection === "pending_operations" && next.decidedByUserId === "system") {
    setIfEarlier("decidedAt");
  } else if (collection === "stage_executions" && next.failureReason === SUPERSEDED_REASON) {
    setIfEarlier("updatedAt");
    setIfEarlier("finalizedAt");
  } else if (collection === "content_items" && next.failureReason === SUPERSEDED_REASON) {
    setIfEarlier("updatedAt");
  } else if (collection === "data_batches" && next.failureCode === SUPERSEDED_REASON) {
    setIfEarlier("updatedAt");
  } else if (collection === "work_items" && next.failureCode === SUPERSEDED_REASON) {
    setIfEarlier("updatedAt");
    setIfEarlier("finalizedAt");
  } else if (collection === "autonomy_cycles" && next.outcome === SUPERSEDED_REASON) {
    setIfEarlier("finishedAt");
  } else if (collection === "cost_reservations" && next.uncertainReason === SUPERSEDED_REASON) {
    setIfEarlier("uncertainAt");
  }

  return { value: changed ? next : doc, changed };
}

function parseArgs(): ScriptArgs {
  const args = process.argv.slice(2);
  const parsed: ScriptArgs = {
    targetIso: DEFAULT_TARGET_ISO,
    dryRun: false,
    batchSize: 250,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--target") {
      parsed.targetIso = args[i + 1] ?? "";
      i += 1;
    } else if (arg === "--target-end") {
      parsed.targetEndIso = args[i + 1] ?? "";
      i += 1;
    } else if (arg === "--dry-run") {
      parsed.dryRun = true;
    } else if (arg === "--batch-size") {
      parsed.batchSize = Number.parseInt(args[i + 1] ?? "", 10);
      i += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      printUsage(`unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return parsed;
}

function printUsage(error?: string): void {
  if (error) process.stdout.write(`${error}\n`);
  process.stdout.write(`Usage:
  npx tsx scripts/reanchor-timestamps.ts [--target "YYYY-MM-DDTHH:mm:ssZ"] [--target-end "YYYY-MM-DDTHH:mm:ssZ"] [--dry-run] [--batch-size N]

  --target      Base timestamp to re-anchor history.
  --target-end  Compress the full history into the inclusive target range.
  --dry-run     Enumerate what would be changed without writing.
  --batch-size  Firestore batch write size (default 250)

Non-terminal worker-facing records are moved to ordinary inert terminal states
after the timestamp shift so historical work cannot be claimed or dispatched.
`);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype
  );
}

function isFirestoreTimestamp(value: unknown): value is { toDate: () => Date } {
  return (
    value !== null
    && typeof value === "object"
    && typeof (value as { toDate?: unknown }).toDate === "function"
    && Object.prototype.hasOwnProperty.call(value as { _seconds?: unknown }, "_seconds")
  );
}

const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:?\d{2})$/;

function timestampMsFromValue(value: unknown): number | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!ISO_TIMESTAMP_PATTERN.test(trimmed)) return null;
    const ms = Date.parse(trimmed);
    return Number.isFinite(ms) ? ms : null;
  }
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : null;
  if (isFirestoreTimestamp(value)) {
    const ms = value.toDate().getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

export function shiftValue(value: unknown, _key: string, deltaMs: number): TransformResult {
  if (isFirestoreTimestamp(value) || value instanceof Date || typeof value === "string") {
    const ms = timestampMsFromValue(value);
    if (ms === null) return { value, changed: false, touchedTimestampValues: 0 };
    if (deltaMs === 0) return { value, changed: false, touchedTimestampValues: 0 };
    const shiftedMs = ms + deltaMs;
    const shifted = isFirestoreTimestamp(value)
      ? Timestamp.fromMillis(shiftedMs)
      : value instanceof Date
        ? new Date(shiftedMs)
        : new Date(shiftedMs).toISOString();
    return {
      value: shifted,
      changed: true,
      touchedTimestampValues: 1,
    };
  }

  if (Array.isArray(value)) {
    let changed = false;
    let touchedTimestampValues = 0;
    const nextValues = value.map((entry) => {
      const nested = shiftValue(entry, _key, deltaMs);
      if (nested.changed) {
        changed = true;
        touchedTimestampValues += nested.touchedTimestampValues;
      }
      return nested.value;
    });
    return { value: changed ? nextValues : value, changed, touchedTimestampValues };
  }

  if (isPlainRecord(value)) {
    let changed = false;
    let touchedTimestampValues = 0;
    const nextValue: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(value)) {
      const nested = shiftValue(childValue, childKey, deltaMs);
      if (nested.changed) {
        changed = true;
        touchedTimestampValues += nested.touchedTimestampValues;
      }
      nextValue[childKey] = nested.value;
    }
    return {
      value: changed ? nextValue : value,
      changed,
      touchedTimestampValues,
    };
  }

  return { value, changed: false, touchedTimestampValues: 0 };
}

function countTimestampValues(value: unknown, key: string, stats: { matchedTimestampValues: number; scannedTimestampValues: number }): void {
  if (value === null || value === undefined) return;
  if (value instanceof Date || isFirestoreTimestamp(value)) {
    stats.scannedTimestampValues += 1;
    if (timestampMsFromValue(value) !== null) stats.matchedTimestampValues += 1;
    return;
  }

  if (typeof value === "string") {
    stats.scannedTimestampValues += 1;
    if (timestampMsFromValue(value) !== null) {
      stats.matchedTimestampValues += 1;
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) countTimestampValues(entry, key, stats);
    return;
  }

  if (isPlainRecord(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      countTimestampValues(childValue, childKey, stats);
    }
  }
}

function scanForEarliest(value: unknown, key: string, current: { firstTimestampMs: number | null }): void {
  if (value === null || value === undefined) return;

  if ((value instanceof Date) || isFirestoreTimestamp(value) || typeof value === "string") {
    const ms = timestampMsFromValue(value);
    if (ms === null) return;
    if (current.firstTimestampMs === null || ms < current.firstTimestampMs) {
      current.firstTimestampMs = ms;
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) scanForEarliest(entry, key, current);
    return;
  }

  if (isPlainRecord(value)) {
    for (const [childKey, childValue] of Object.entries(value)) {
      scanForEarliest(childValue, childKey, current);
    }
  }
}

function remapValue(value: unknown, mapMs: (ms: number) => number): TransformResult {
  if (isFirestoreTimestamp(value) || value instanceof Date || typeof value === "string") {
    const ms = timestampMsFromValue(value); if (ms === null) return { value, changed: false, touchedTimestampValues: 0 };
    const mapped = mapMs(ms); const next = isFirestoreTimestamp(value) ? Timestamp.fromMillis(mapped) : value instanceof Date ? new Date(mapped) : new Date(mapped).toISOString();
    return { value: next, changed: mapped !== ms, touchedTimestampValues: mapped === ms ? 0 : 1 };
  }
  if (Array.isArray(value)) { let changed = false; let touchedTimestampValues = 0; const next = value.map((item) => { const result = remapValue(item, mapMs); changed ||= result.changed; touchedTimestampValues += result.touchedTimestampValues; return result.value; }); return { value: changed ? next : value, changed, touchedTimestampValues }; }
  if (isPlainRecord(value)) { let changed = false; let touchedTimestampValues = 0; const next: Record<string, unknown> = {}; for (const [key, item] of Object.entries(value)) { const result = remapValue(item, mapMs); changed ||= result.changed; touchedTimestampValues += result.touchedTimestampValues; next[key] = result.value; } return { value: changed ? next : value, changed, touchedTimestampValues }; }
  return { value, changed: false, touchedTimestampValues: 0 };
}

type DocVisitor = (ref: DocumentReference, data: DocumentData) => Promise<void>;

async function walkCollection(collectionRef: CollectionReference, visitor: DocVisitor): Promise<void> {
  const snapshot = await collectionRef.get();
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(20, snapshot.docs.length) }, async () => {
    while (nextIndex < snapshot.docs.length) {
      const document = snapshot.docs[nextIndex++];
      await visitor(document.ref, document.data());
      const subCollections = await document.ref.listCollections();
      await Promise.all(subCollections.map((sub) => walkCollection(sub, visitor)));
    }
  });
  await Promise.all(workers);
}

async function walkDatabase(
  db: Firestore,
  visitor: DocVisitor,
): Promise<void> {
  const root = await db.listCollections();
  for (const rootCollection of root) {
    await walkCollection(rootCollection, visitor);
  }
}

async function findTimestampOrigin(db: Firestore): Promise<number | null> {
  const state = { firstTimestampMs: null as number | null };
  let scannedDocuments = 0;
  await walkDatabase(db, async (ref, data) => {
    scannedDocuments += 1;
    if (scannedDocuments % 10 === 0) {
      process.stdout.write(`Scanned ${scannedDocuments} documents; current path: ${ref.path}\n`);
    }
    const payload = data as Record<string, unknown>;
    for (const [key, value] of Object.entries(payload)) {
      scanForEarliest(value, key, state);
    }
  });
  return state.firstTimestampMs;
}

async function findTimestampRange(db: Firestore): Promise<{ first: number; last: number } | null> {
  let first: number | null = null; let last: number | null = null;
  await walkDatabase(db, async (_ref, data) => {
    const visit = (value: unknown): void => { const ms = timestampMsFromValue(value); if (ms !== null) { first = first === null ? ms : Math.min(first, ms); last = last === null ? ms : Math.max(last, ms); return; } if (Array.isArray(value)) value.forEach(visit); else if (isPlainRecord(value)) Object.values(value).forEach(visit); };
    visit(data);
  });
  return first === null || last === null ? null : { first, last };
}

async function applyShift(
  db: Firestore,
  deltaMs: number,
  nowIso: string,
  dryRun: boolean,
  batchSize: number,
  mapMs?: (ms: number) => number,
): Promise<MigrationStats> {
  const stats: MigrationStats = {
    scannedDocs: 0,
    scannedTimestampValues: 0,
    matchedTimestampValues: 0,
    updatedDocs: 0,
    updatedTimestampValues: 0,
    neutralizedDocs: 0,
    firstTimestampMs: null,
  };

  let batch = db.batch();
  let queuedWrites = 0;
  let writeChain = Promise.resolve();

  async function flushBatch(): Promise<void> {
    if (queuedWrites === 0) return;
    await batch.commit();
    batch = db.batch();
    queuedWrites = 0;
  }

  await walkDatabase(db, async (ref, data) => {
    stats.scannedDocs += 1;
    countTimestampValues(data as unknown, "", stats);
    const transformed = mapMs ? remapValue(data, mapMs) : shiftValue(data, "", deltaMs);
    const controlPlane = inertCollectionForPath(ref.path);
    let nextData = transformed.value;
    let touchedControlPlane = false;
    if (controlPlane !== null && isPlainRecord(nextData)) {
      const transitionIso = historicalTransitionIso(nextData as Record<string, unknown>, nowIso);
      const neutralized = makeDocumentInert(controlPlane, nextData as Record<string, unknown>, transitionIso);
      nextData = neutralized.value;
      touchedControlPlane = neutralized.changed;
      const repaired = repairInertTimeline(
        controlPlane,
        nextData as Record<string, unknown>,
        transitionIso,
      );
      nextData = repaired.value;
      touchedControlPlane = touchedControlPlane || repaired.changed;
    }

    if (transformed.changed || touchedControlPlane) {
      stats.updatedDocs += 1;
      stats.updatedTimestampValues += transformed.touchedTimestampValues;
      if (touchedControlPlane) stats.neutralizedDocs += 1;
      if (!dryRun) {
        writeChain = writeChain.then(async () => {
          batch.set(ref, nextData as DocumentData, { merge: true });
          queuedWrites += 1;
          if (queuedWrites >= batchSize) await flushBatch();
        });
        await writeChain;
      }
    }
  });

  await writeChain;
  await flushBatch();
  return stats;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const targetMs = Date.parse(args.targetIso);
  if (!Number.isFinite(targetMs)) {
    throw new Error(`Invalid --target value: ${args.targetIso}`);
  }
  if (!Number.isInteger(args.batchSize) || args.batchSize <= 0) {
    throw new Error(`Invalid --batch-size value: ${args.batchSize}`);
  }

  const db = new Firestore({ projectId: process.env.GOOGLE_CLOUD_PROJECT || undefined });
  try {
    const range = args.targetEndIso ? await findTimestampRange(db) : null;
    const initialMs = range?.first ?? await findTimestampOrigin(db);
    if (initialMs === null) {
      process.stdout.write("No timestamp-like values found. No documents to re-anchor.\n");
      return;
    }

    const targetEndMs = args.targetEndIso ? Date.parse(args.targetEndIso) : null;
    if (targetEndMs !== null && (!Number.isFinite(targetEndMs) || targetEndMs <= targetMs)) throw new Error("Invalid --target-end value");
    const deltaMs = targetMs - initialMs;
    process.stdout.write(`Discovered earliest timestamp: ${new Date(initialMs).toISOString()}\n`);
    process.stdout.write(`Re-anchoring target: ${new Date(targetMs).toISOString()}\n`);
    process.stdout.write(`Computed shift: ${deltaMs >= 0 ? "+" : ""}${deltaMs}ms\n`);
    if (args.dryRun) process.stdout.write("Running in dry-run mode; no writes will be made.\n");

    const anchorNowIso = new Date(targetMs).toISOString();
    const mapMs = range && targetEndMs !== null ? (ms: number) => Math.round(targetMs + ((ms - range.first) * (targetEndMs - targetMs)) / Math.max(1, range.last - range.first)) : undefined;
    const stats = await applyShift(db, deltaMs, anchorNowIso, args.dryRun, args.batchSize, mapMs);
    stats.firstTimestampMs = initialMs;
    process.stdout.write(`${JSON.stringify(stats, null, 2)}\n`);
    process.stdout.write("Re-anchor operation complete.\n");
  } finally {
    await db.terminate();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().catch((error) => {
    process.stderr.write(`${String(error instanceof Error ? error.stack ?? error.message : error)}\n`);
    process.exit(1);
  });
}
