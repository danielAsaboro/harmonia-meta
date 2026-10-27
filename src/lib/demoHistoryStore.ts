import { createHash } from "node:crypto";

import type { DocumentData, DocumentReference } from "@google-cloud/firestore";

import {
  buildDemoProvenance,
  collectInstants,
  demoDocumentId,
  isIsoInstant,
  shiftDemoValue,
} from "./demoHistory";
import { db } from "./firestore";
import { canonicalJson } from "./recordReplay/integrity";

const EXECUTABLE_COLLECTIONS = new Set([
  "commands",
  "effect_commands",
  "effects",
  "event_inbox",
  "event_outbox",
  "operation_claims",
  "operations",
  "pending_operations",
  "production_operation_outbox",
  "recovery_work",
  "scheduled_effects",
  "scheduler_outbox",
  "stage_executions",
  "stage_outbox",
]);

export interface DemoHistoryInput {
  workspaceId: string;
  brandId: string;
  datasetId: string;
  anchor: string;
}

interface SourceDocument {
  sourcePath: string;
  data: DocumentData;
  jobRootId?: string;
  brandRoot?: boolean;
}

export interface DemoHistoryRecordPlan {
  sourcePath: string;
  intendedDestinationPath: string;
  actualDestinationPath: string;
  quarantined: boolean;
  sourceDigest: string;
  destinationDigest: string;
  sourceInstants: number[];
  demoInstants: number[];
  data: DocumentData;
}

export interface DemoHistoryPlan extends DemoHistoryInput {
  manifestPath: string;
  digest: string;
  offsetMs: number;
  minimumSourceTimestamp: string;
  minimumDemoTimestamp: string;
  sourceJobCount: number;
  sourceRecordCount: number;
  liveDestinationCount: number;
  quarantinedRecordCount: number;
  unsafeLiveDestinationCount: number;
  records: DemoHistoryRecordPlan[];
}

export interface DemoHistoryManifest {
  schemaVersion: 1;
  kind: "teaching_demo";
  datasetId: string;
  workspaceId: string;
  brandId: string;
  anchor: string;
  minimumSourceTimestamp: string;
  minimumDemoTimestamp: string;
  offsetMs: number;
  planDigest: string;
  sourceJobCount: number;
  sourceRecordCount: number;
  liveDestinationCount: number;
  quarantinedRecordCount: number;
  createdAt: string;
  cleanupCommand: string;
}

export interface DemoHistoryVerification {
  sourceUnchanged: boolean;
  minimumTimestampMatchesAnchor: boolean;
  relativeIntervalsPreserved: boolean;
  executableDestinationCount: number;
  manifestDigestMatches: boolean;
  recordCountMatches: boolean;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function assertDocumentId(label: string, value: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(value)) throw new Error(`invalid ${label}`);
}

function pathCollections(path: string): string[] {
  return path.split("/").filter((_part, index) => index % 2 === 0);
}

function isExecutablePath(path: string): boolean {
  return pathCollections(path).some((collection) => EXECUTABLE_COLLECTIONS.has(collection));
}

function replaceExactIds(value: unknown, replacements: ReadonlyMap<string, string>): unknown {
  if (typeof value === "string") return replacements.get(value) ?? value;
  if (Array.isArray(value)) return value.map((item) => replaceExactIds(item, replacements));
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .map(([key, item]) => [key, replaceExactIds(item, replacements)]),
    );
  }
  return value;
}

async function collectDocumentTree(
  ref: DocumentReference,
  root: Pick<SourceDocument, "jobRootId" | "brandRoot">,
): Promise<SourceDocument[]> {
  const snapshot = await ref.get();
  if (!snapshot.exists) return [];
  const records: SourceDocument[] = [{ sourcePath: ref.path, data: snapshot.data()!, ...root }];
  const collections = await ref.listCollections();
  for (const collection of collections) {
    const children = await collection.get();
    for (const child of children.docs) {
      records.push(...await collectDocumentTree(child.ref, root));
    }
  }
  return records;
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function discoverBrandRecords(input: DemoHistoryInput, jobIds: readonly string[]): Promise<SourceDocument[]> {
  if (jobIds.length === 0) return [];
  const brandRef = db().doc(`workspaces/${input.workspaceId}/brands/${input.brandId}`);
  const collections = (await brandRef.listCollections()).filter((collection) => collection.id !== "demo_datasets");
  const records = new Map<string, SourceDocument>();
  for (const collection of collections) {
    for (const group of chunks(jobIds, 30)) {
      const snapshots = await collection.where("jobId", "in", group).get();
      for (const snapshot of snapshots.docs) {
        for (const record of await collectDocumentTree(snapshot.ref, { brandRoot: true })) {
          records.set(record.sourcePath, record);
        }
      }
    }
  }
  return [...records.values()];
}

function sourceDocumentId(path: string): string {
  return path.split("/").at(-1)!;
}

function destinationForSource(
  source: SourceDocument,
  input: DemoHistoryInput,
  jobIds: ReadonlyMap<string, string>,
): string {
  const jobPrefix = `workspaces/${input.workspaceId}/jobs/`;
  if (source.sourcePath.startsWith(jobPrefix) && source.jobRootId) {
    const suffix = source.sourcePath.slice(`${jobPrefix}${source.jobRootId}`.length);
    return `${jobPrefix}${jobIds.get(source.jobRootId)!}${suffix}`;
  }
  const segments = source.sourcePath.split("/");
  const rootDocumentIndex = 5;
  segments[rootDocumentIndex] = demoDocumentId(input.datasetId, source.sourcePath.split("/").slice(0, 6).join("/"));
  return segments.join("/");
}

function createReplacementMap(
  sources: readonly SourceDocument[],
  destinations: ReadonlyMap<string, string>,
  jobIds: ReadonlyMap<string, string>,
): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const [sourceId, destinationId] of jobIds) candidates.set(sourceId, new Set([destinationId]));
  for (const source of sources.filter((record) => record.brandRoot)) {
    const sourceId = sourceDocumentId(source.sourcePath);
    const destinationId = sourceDocumentId(destinations.get(source.sourcePath)!);
    const values = candidates.get(sourceId) ?? new Set<string>();
    values.add(destinationId);
    candidates.set(sourceId, values);
  }
  return new Map(
    [...candidates.entries()]
      .filter(([_sourceId, values]) => values.size === 1)
      .map(([sourceId, values]) => [sourceId, [...values][0]]),
  );
}

function planDigest(input: Omit<DemoHistoryPlan, "digest" | "records">, records: readonly DemoHistoryRecordPlan[]): string {
  return digest({
    ...input,
    records: records.map((record) => ({
      sourcePath: record.sourcePath,
      intendedDestinationPath: record.intendedDestinationPath,
      actualDestinationPath: record.actualDestinationPath,
      quarantined: record.quarantined,
      sourceDigest: record.sourceDigest,
      destinationDigest: record.destinationDigest,
      sourceInstants: record.sourceInstants,
      demoInstants: record.demoInstants,
    })),
  });
}

export async function discoverDemoHistory(input: DemoHistoryInput): Promise<DemoHistoryPlan> {
  assertDocumentId("workspace id", input.workspaceId);
  assertDocumentId("brand id", input.brandId);
  assertDocumentId("dataset id", input.datasetId);
  if (!isIsoInstant(input.anchor)) throw new Error("invalid demo history anchor");

  const normalizedInput: DemoHistoryInput = {
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    datasetId: input.datasetId,
    anchor: new Date(input.anchor).toISOString(),
  };

  const jobSnapshots = await db().collection(`workspaces/${input.workspaceId}/jobs`)
    .where("brandId", "==", input.brandId).get();
  const sourceJobs = jobSnapshots.docs.filter((snapshot) => !snapshot.get("demoProvenance"));
  if (sourceJobs.length === 0) throw new Error("no source jobs found for demo history");

  const sources: SourceDocument[] = [];
  for (const job of sourceJobs) {
    sources.push(...await collectDocumentTree(job.ref, { jobRootId: job.id }));
  }
  sources.push(...await discoverBrandRecords(input, sourceJobs.map((snapshot) => snapshot.id)));
  const uniqueSources = [...new Map(sources.map((source) => [source.sourcePath, source])).values()]
    .sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
  const instants = uniqueSources.flatMap((source) => collectInstants(source.data));
  if (instants.length === 0) throw new Error("source job history has no timestamps");
  const minimumSourceMs = Math.min(...instants);
  const anchorMs = Date.parse(input.anchor);
  const offsetMs = anchorMs - minimumSourceMs;
  if (!Number.isSafeInteger(offsetMs)) throw new Error("demo history offset exceeds safe range");

  const jobIds = new Map(sourceJobs.map((snapshot) => [
    snapshot.id,
    demoDocumentId(input.datasetId, snapshot.ref.path),
  ]));
  const intendedDestinations = new Map(uniqueSources.map((source) => [
    source.sourcePath,
    destinationForSource(source, input, jobIds),
  ]));
  const replacements = createReplacementMap(uniqueSources, intendedDestinations, jobIds);
  const manifestPath = `workspaces/${input.workspaceId}/brands/${input.brandId}/demo_datasets/${input.datasetId}`;

  const records = uniqueSources.map((source): DemoHistoryRecordPlan => {
    const intendedDestinationPath = intendedDestinations.get(source.sourcePath)!;
    const quarantined = isExecutablePath(intendedDestinationPath);
    const shifted = replaceExactIds(shiftDemoValue(source.data, offsetMs), replacements) as DocumentData;
    const isJobRoot = Boolean(source.jobRootId) && source.sourcePath === `workspaces/${input.workspaceId}/jobs/${source.jobRootId}`;
    const destinationId = sourceDocumentId(intendedDestinationPath);
    const data = {
      ...shifted,
      ...(isJobRoot ? { id: destinationId, status: "complete", stage: "complete" } : {}),
      ...(source.brandRoot && source.sourcePath.split("/").length === 6 ? { id: destinationId } : {}),
      demoProvenance: buildDemoProvenance({
        datasetId: input.datasetId,
        sourcePath: source.sourcePath,
        originAnchor: input.anchor,
        ...(isJobRoot && typeof source.data.status === "string" ? { originalStatus: source.data.status } : {}),
        ...(isJobRoot && typeof source.data.stage === "string" ? { originalStage: source.data.stage } : {}),
      }),
    };
    const actualDestinationPath = quarantined
      ? `${manifestPath}/records/${demoDocumentId(input.datasetId, source.sourcePath)}`
      : intendedDestinationPath;
    return {
      sourcePath: source.sourcePath,
      intendedDestinationPath,
      actualDestinationPath,
      quarantined,
      sourceDigest: digest(source.data),
      destinationDigest: digest(data),
      sourceInstants: collectInstants(source.data),
      demoInstants: collectInstants(shifted),
      data,
    };
  });
  const unsafeLiveDestinationCount = records.filter((record) => !record.quarantined && isExecutablePath(record.intendedDestinationPath)).length;
  const base = {
    ...normalizedInput,
    manifestPath,
    offsetMs,
    minimumSourceTimestamp: new Date(minimumSourceMs).toISOString(),
    minimumDemoTimestamp: new Date(minimumSourceMs + offsetMs).toISOString(),
    sourceJobCount: sourceJobs.length,
    sourceRecordCount: records.length,
    liveDestinationCount: records.filter((record) => !record.quarantined).length,
    quarantinedRecordCount: records.filter((record) => record.quarantined).length,
    unsafeLiveDestinationCount,
  };
  return { ...base, digest: planDigest(base, records), records };
}

function auditRecord(plan: DemoHistoryPlan, record: DemoHistoryRecordPlan): DocumentData {
  return {
    sourcePath: record.sourcePath,
    intendedDestinationPath: record.intendedDestinationPath,
    actualDestinationPath: record.actualDestinationPath,
    quarantined: record.quarantined,
    sourceDigest: record.sourceDigest,
    destinationDigest: record.destinationDigest,
    sourceInstants: record.sourceInstants,
    demoInstants: record.demoInstants,
    planDigest: plan.digest,
    ...(record.quarantined ? { payload: record.data } : {}),
  };
}

export async function applyDemoHistory(
  plan: DemoHistoryPlan,
  expectedDigest: string,
): Promise<DemoHistoryManifest> {
  if (expectedDigest !== plan.digest) throw new Error("demo history plan digest mismatch");
  if (plan.unsafeLiveDestinationCount !== 0) throw new Error("demo history plan contains unsafe live destinations");
  const manifestRef = db().doc(plan.manifestPath);
  if ((await manifestRef.get()).exists) throw new Error("demo dataset already exists");
  const liveDestinations = plan.records.filter((record) => !record.quarantined);
  const existing = await db().getAll(...liveDestinations.map((record) => db().doc(record.actualDestinationPath)));
  if (existing.some((snapshot) => snapshot.exists)) throw new Error("demo history destination already exists");

  const cleanupCommand = `npx tsx scripts/create-demo-history.ts --cleanup --manifest ${plan.manifestPath}`;
  const manifest: DemoHistoryManifest = {
    schemaVersion: 1,
    kind: "teaching_demo",
    datasetId: plan.datasetId,
    workspaceId: plan.workspaceId,
    brandId: plan.brandId,
    anchor: plan.anchor,
    minimumSourceTimestamp: plan.minimumSourceTimestamp,
    minimumDemoTimestamp: plan.minimumDemoTimestamp,
    offsetMs: plan.offsetMs,
    planDigest: plan.digest,
    sourceJobCount: plan.sourceJobCount,
    sourceRecordCount: plan.sourceRecordCount,
    liveDestinationCount: plan.liveDestinationCount,
    quarantinedRecordCount: plan.quarantinedRecordCount,
    createdAt: new Date().toISOString(),
    cleanupCommand,
  };

  const writer = db().bulkWriter();
  for (const record of plan.records) {
    if (!record.quarantined) writer.create(db().doc(record.actualDestinationPath), record.data);
    writer.create(
      manifestRef.collection("records").doc(demoDocumentId(plan.datasetId, record.sourcePath)),
      auditRecord(plan, record),
    );
  }
  writer.create(manifestRef, manifest);
  await writer.close();
  return manifest;
}

export async function verifyDemoHistory(manifestPath: string): Promise<DemoHistoryVerification> {
  const manifestSnapshot = await db().doc(manifestPath).get();
  if (!manifestSnapshot.exists) throw new Error("demo history manifest not found");
  const manifest = manifestSnapshot.data() as DemoHistoryManifest;
  const audits = await manifestSnapshot.ref.collection("records").get();
  let sourceUnchanged = true;
  let relativeIntervalsPreserved = true;
  let executableDestinationCount = 0;
  const demoInstants: number[] = [];
  for (const auditSnapshot of audits.docs) {
    const audit = auditSnapshot.data() as {
      sourcePath: string;
      intendedDestinationPath: string;
      actualDestinationPath: string;
      quarantined: boolean;
      sourceDigest: string;
      destinationDigest: string;
      sourceInstants: number[];
      demoInstants: number[];
      planDigest: string;
      payload?: DocumentData;
    };
    const source = await db().doc(audit.sourcePath).get();
    if (!source.exists || digest(source.data()) !== audit.sourceDigest) sourceUnchanged = false;
    const destinationData = audit.quarantined
      ? audit.payload
      : (await db().doc(audit.actualDestinationPath).get()).data();
    if (!destinationData || digest(destinationData) !== audit.destinationDigest) sourceUnchanged = false;
    if (!audit.quarantined && isExecutablePath(audit.intendedDestinationPath)) executableDestinationCount += 1;
    if (audit.sourceInstants.length !== audit.demoInstants.length
      || audit.sourceInstants.some((instant, index) => audit.demoInstants[index] - instant !== manifest.offsetMs)) {
      relativeIntervalsPreserved = false;
    }
    demoInstants.push(...audit.demoInstants);
  }
  return {
    sourceUnchanged,
    minimumTimestampMatchesAnchor: demoInstants.length > 0
      && new Date(Math.min(...demoInstants)).toISOString() === manifest.anchor,
    relativeIntervalsPreserved,
    executableDestinationCount,
    manifestDigestMatches: audits.docs.every((snapshot) => snapshot.get("planDigest") === manifest.planDigest),
    recordCountMatches: audits.size === manifest.sourceRecordCount,
  };
}
