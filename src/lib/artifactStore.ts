import type { Firestore } from "@google-cloud/firestore";

import {
  artifactObjectKey,
  boundedArtifactRead,
  boundedArtifactReadLines,
  createArtifactRecord,
  validateArtifactBytes,
  type ArtifactBytePage,
  type ArtifactLinePage,
  type ArtifactProducer,
  type ArtifactRecord,
  type ArtifactRetentionClass,
  type ArtifactTrust,
} from "./artifacts";
import { newId } from "./idempotency";
import {
  durableArtifactUri,
  getDurableArtifactObject,
  putDurableArtifactObject,
} from "./storage";
import { currentTenant, tenantCollectionPath } from "./tenancy";

const ARTIFACTS = "artifacts";
const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface ArtifactMetadataStore {
  create(path: string, record: ArtifactRecord): Promise<void>;
  set(path: string, record: ArtifactRecord): Promise<void>;
  get(path: string): Promise<ArtifactRecord | null>;
}

export interface ArtifactByteStore {
  uri(key: string): string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer | null>;
}

export interface ArtifactStoreClock {
  id(): string;
  now(): string;
}

export interface CreateArtifactInput {
  jobId: string;
  operationId: string;
  bytes: Uint8Array;
  contentType: string;
  encoding?: string;
  itemCount?: number;
  trust: ArtifactTrust;
  sourceEventId?: string;
  rightsAuthorizationId?: string;
  producer: ArtifactProducer;
  retentionClass: ArtifactRetentionClass;
  expiresAt?: string;
}

export type ArtifactReadInput =
  | { offset: number; length: number }
  | { lineStart: number; lineCount: number };

export type ArtifactReadResult =
  | ({ kind: "bytes"; record: ArtifactRecord } & ArtifactBytePage)
  | ({ kind: "lines"; record: ArtifactRecord } & ArtifactLinePage);

function artifactPath(id: string): string {
  if (!ARTIFACT_ID.test(id)) throw new Error("invalid artifact id");
  return `${tenantCollectionPath(currentTenant(), ARTIFACTS)}/${id}`;
}

function assertTenant(record: ArtifactRecord): void {
  const tenant = currentTenant();
  if (record.workspaceId !== tenant.workspaceId || record.brandId !== tenant.brandId) {
    throw new Error("artifact tenant mismatch");
  }
}

export class ArtifactStore {
  constructor(
    private readonly metadata: ArtifactMetadataStore,
    private readonly objects: ArtifactByteStore,
    private readonly clock: ArtifactStoreClock = {
      id: newId,
      now: () => new Date().toISOString(),
    },
  ) {}

  async create(input: CreateArtifactInput): Promise<ArtifactRecord> {
    const tenant = currentTenant();
    const id = this.clock.id();
    const key = artifactObjectKey(tenant, id);
    const now = this.clock.now();
    const intent = createArtifactRecord({
      id,
      workspaceId: tenant.workspaceId,
      brandId: tenant.brandId,
      jobId: input.jobId,
      operationId: input.operationId,
      uri: this.objects.uri(key),
      bytes: input.bytes,
      contentType: input.contentType,
      ...(input.encoding ? { encoding: input.encoding } : {}),
      ...(input.itemCount !== undefined ? { itemCount: input.itemCount } : {}),
      trust: input.trust,
      ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
      ...(input.rightsAuthorizationId ? { rightsAuthorizationId: input.rightsAuthorizationId } : {}),
      producer: input.producer,
      retentionClass: input.retentionClass,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      now,
    });
    const path = artifactPath(id);
    await this.metadata.create(path, intent);
    try {
      await this.objects.put(key, input.bytes, input.contentType);
      const ready: ArtifactRecord = { ...intent, state: "ready", updatedAt: this.clock.now() };
      await this.metadata.set(path, ready);
      return ready;
    } catch (error) {
      const failureReason = `artifact byte storage failed (${error instanceof Error ? error.constructor.name : "Unknown"})`;
      await this.metadata.set(path, {
        ...intent,
        state: "failed",
        failureReason,
        updatedAt: this.clock.now(),
      });
      throw error;
    }
  }

  async get(id: string): Promise<ArtifactRecord | null> {
    const record = await this.metadata.get(artifactPath(id));
    if (record) assertTenant(record);
    return record;
  }

  async materialize(id: string): Promise<{ record: ArtifactRecord; bytes: Buffer }> {
    const record = await this.get(id);
    if (!record) throw new Error("artifact not found");
    if (record.state !== "ready") throw new Error(`artifact is ${record.state}`);
    const key = artifactObjectKey(currentTenant(), id);
    const bytes = await this.objects.get(key);
    if (!bytes) throw new Error("artifact bytes are missing");
    validateArtifactBytes(record, bytes);
    return { record, bytes };
  }

  async read(id: string, input: ArtifactReadInput): Promise<ArtifactReadResult> {
    const { record, bytes } = await this.materialize(id);
    if ("lineStart" in input) {
      return { kind: "lines", record, ...boundedArtifactReadLines(bytes, input) };
    }
    return { kind: "bytes", record, ...boundedArtifactRead(bytes, input) };
  }
}

export class FirestoreArtifactMetadataStore implements ArtifactMetadataStore {
  constructor(private readonly database: Firestore) {}
  async create(path: string, record: ArtifactRecord): Promise<void> {
    await this.database.doc(path).create(record);
  }
  async set(path: string, record: ArtifactRecord): Promise<void> {
    await this.database.doc(path).set(record);
  }
  async get(path: string): Promise<ArtifactRecord | null> {
    const snapshot = await this.database.doc(path).get();
    return snapshot.exists ? snapshot.data() as ArtifactRecord : null;
  }
}

export class DurableArtifactByteStore implements ArtifactByteStore {
  uri(key: string): string {
    return durableArtifactUri(key);
  }
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    return putDurableArtifactObject(key, bytes, contentType);
  }
  get(key: string): Promise<Buffer | null> {
    return getDurableArtifactObject(key);
  }
}

export function createArtifactStore(database: Firestore): ArtifactStore {
  return new ArtifactStore(
    new FirestoreArtifactMetadataStore(database),
    new DurableArtifactByteStore(),
  );
}
