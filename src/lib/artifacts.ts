import { createHash } from "node:crypto";

import type { TenantScope } from "./tenancy";

export type ArtifactTrust = "system" | "operator" | "provider" | "external_untrusted" | "model_inference";
export type ArtifactRetentionClass = "operational" | "audit" | "source" | "ephemeral";
export type ArtifactState = "writing" | "ready" | "failed";

export interface ArtifactProducer {
  kind: string;
  id: string;
  version: string;
}

export interface ArtifactRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  jobId: string;
  operationId: string;
  uri: string;
  sha256: string;
  contentType: string;
  encoding?: string;
  byteCount: number;
  lineCount?: number;
  itemCount?: number;
  preview: string;
  trust: ArtifactTrust;
  sourceEventId?: string;
  rightsAuthorizationId?: string;
  producer: ArtifactProducer;
  retentionClass: ArtifactRetentionClass;
  state: ArtifactState;
  failureReason?: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateArtifactRecordInput {
  id: string;
  workspaceId: string;
  brandId: string;
  jobId: string;
  operationId: string;
  uri: string;
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
  now: string;
}

export interface ArtifactBytePage {
  bytes: Buffer;
  offset: number;
  nextOffset: number;
  complete: boolean;
}

export interface ArtifactLinePage {
  text: string;
  lineStart: number;
  nextLine: number;
  complete: boolean;
}

const ARTIFACT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TEXT_CONTENT = /^(text\/|application\/(json|xml|yaml|x-ndjson))/i;
const MAX_PREVIEW_CHARS = 2_048;
const MAX_READ_BYTES = 65_536;
const MAX_READ_LINES = 200;

function assertTimestamp(value: string, label: string): void {
  if (!Number.isFinite(Date.parse(value))) throw new Error(`invalid ${label}`);
}

function textPreview(bytes: Uint8Array, contentType: string): string {
  if (!TEXT_CONTENT.test(contentType)) return `[binary ${contentType}; ${bytes.byteLength} bytes]`;
  const text = Buffer.from(bytes).toString("utf8");
  if (text.length <= MAX_PREVIEW_CHARS) return text;
  const side = Math.floor((MAX_PREVIEW_CHARS - 40) / 2);
  return `${text.slice(0, side)}\n… ${text.length - side * 2} chars spilled …\n${text.slice(-side)}`;
}

export function artifactDigest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function artifactObjectKey(scope: TenantScope, artifactId: string): string {
  if (!ARTIFACT_ID.test(artifactId)) throw new Error("invalid artifact id");
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(scope.workspaceId)
    || !/^[A-Za-z0-9_-]{1,128}$/.test(scope.brandId)) {
    throw new Error("invalid artifact tenant scope");
  }
  return `durable-artifacts/${scope.workspaceId}/${scope.brandId}/${artifactId}`;
}

export function createArtifactRecord(input: CreateArtifactRecordInput): ArtifactRecord {
  artifactObjectKey(input, input.id);
  assertTimestamp(input.now, "artifact timestamp");
  if (input.expiresAt) assertTimestamp(input.expiresAt, "artifact expiry");
  if (!input.jobId || !input.operationId || !input.uri || !input.contentType) {
    throw new Error("artifact identity and content type are required");
  }
  if (input.bytes.byteLength < 1) throw new Error("artifact bytes are empty");
  if (!input.producer.kind || !input.producer.id || !input.producer.version) {
    throw new Error("artifact producer is incomplete");
  }
  const isText = TEXT_CONTENT.test(input.contentType);
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    jobId: input.jobId,
    operationId: input.operationId,
    uri: input.uri,
    sha256: artifactDigest(input.bytes),
    contentType: input.contentType,
    ...(input.encoding ? { encoding: input.encoding } : isText ? { encoding: "utf-8" } : {}),
    byteCount: input.bytes.byteLength,
    ...(isText ? { lineCount: Buffer.from(input.bytes).toString("utf8").split(/\r?\n/).length } : {}),
    ...(input.itemCount !== undefined ? { itemCount: input.itemCount } : {}),
    preview: textPreview(input.bytes, input.contentType),
    trust: input.trust,
    ...(input.sourceEventId ? { sourceEventId: input.sourceEventId } : {}),
    ...(input.rightsAuthorizationId ? { rightsAuthorizationId: input.rightsAuthorizationId } : {}),
    producer: { ...input.producer },
    retentionClass: input.retentionClass,
    state: "writing",
    ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function validateArtifactBytes(record: ArtifactRecord, bytes: Uint8Array): void {
  if (artifactDigest(bytes) !== record.sha256) throw new Error("artifact digest mismatch");
  if (bytes.byteLength !== record.byteCount) throw new Error("artifact byte count mismatch");
}

export function boundedArtifactRead(
  bytes: Uint8Array,
  input: { offset: number; length: number },
): ArtifactBytePage {
  if (!Number.isSafeInteger(input.offset) || input.offset < 0) throw new Error("invalid artifact byte offset");
  if (!Number.isSafeInteger(input.length) || input.length < 1) throw new Error("invalid artifact byte length");
  if (input.length > MAX_READ_BYTES) throw new Error(`artifact read exceeds ${MAX_READ_BYTES} bytes`);
  const offset = Math.min(input.offset, bytes.byteLength);
  const nextOffset = Math.min(offset + input.length, bytes.byteLength);
  return {
    bytes: Buffer.from(bytes.slice(offset, nextOffset)),
    offset,
    nextOffset,
    complete: nextOffset >= bytes.byteLength,
  };
}

export function boundedArtifactReadLines(
  bytes: Uint8Array,
  input: { lineStart: number; lineCount: number },
): ArtifactLinePage {
  if (!Number.isSafeInteger(input.lineStart) || input.lineStart < 0) throw new Error("invalid artifact line offset");
  if (!Number.isSafeInteger(input.lineCount) || input.lineCount < 1) throw new Error("invalid artifact line count");
  if (input.lineCount > MAX_READ_LINES) throw new Error(`artifact line read exceeds ${MAX_READ_LINES} lines`);
  const lines = Buffer.from(bytes).toString("utf8").split(/\r?\n/);
  const lineStart = Math.min(input.lineStart, lines.length);
  const nextLine = Math.min(lineStart + input.lineCount, lines.length);
  const text = lines.slice(lineStart, nextLine).join("\n");
  if (Buffer.byteLength(text, "utf8") > MAX_READ_BYTES) {
    throw new Error(`artifact line window exceeds ${MAX_READ_BYTES} bytes`);
  }
  return { text, lineStart, nextLine, complete: nextLine >= lines.length };
}
