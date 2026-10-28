/**
 * Binary artifact storage. Cloud: GCS bucket (GCS_BUCKET). Local dev: files
 * under .data/artifacts/. Firestore keeps only metadata; bytes live here.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getConfig } from "./config";
import { currentTenant } from "./tenancy";

const LOCAL_ROOT = path.join(process.cwd(), ".data", "artifacts");

function scopedKey(key: string): string {
  return `${currentTenant().workspaceId}/${currentTenant().brandId}/${key}`;
}

function localPath(key: string): string {
  const safe = key.replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(LOCAL_ROOT, currentTenant().workspaceId, currentTenant().brandId, safe);
}

function durableLocalPath(objectKey: string): string {
  const allowedPrefix = `durable-artifacts/${currentTenant().workspaceId}/${currentTenant().brandId}/`;
  if (!objectKey.startsWith(allowedPrefix) || objectKey.includes("..") || objectKey.includes("\\")) {
    throw new Error("durable artifact key is outside the current tenant storage scope");
  }
  return path.join(process.cwd(), ".data", ...objectKey.split("/"));
}

function assertDurableObjectKey(objectKey: string): void {
  durableLocalPath(objectKey);
}

export function durableArtifactUri(objectKey: string): string {
  assertDurableObjectKey(objectKey);
  const bucket = process.env.GCS_BUCKET;
  return bucket ? `gs://${bucket}/${objectKey}` : `file://${objectKey}`;
}

export async function putDurableArtifactObject(
  objectKey: string,
  bytes: Uint8Array,
  mime: string,
): Promise<void> {
  assertDurableObjectKey(objectKey);
  const bucket = process.env.GCS_BUCKET;
  if (bucket) {
    const { Storage } = await import("@google-cloud/storage");
    await new Storage({ projectId: getConfig().GOOGLE_CLOUD_PROJECT })
      .bucket(bucket).file(objectKey).save(bytes, { contentType: mime, resumable: false });
    return;
  }
  const target = durableLocalPath(objectKey);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
}

export async function getDurableArtifactObject(objectKey: string): Promise<Buffer | null> {
  assertDurableObjectKey(objectKey);
  const bucket = process.env.GCS_BUCKET;
  if (bucket) {
    const { Storage } = await import("@google-cloud/storage");
    const file = new Storage({ projectId: getConfig().GOOGLE_CLOUD_PROJECT })
      .bucket(bucket).file(objectKey);
    try {
      const [exists] = await file.exists();
      if (!exists) return null;
      const [contents] = await file.download();
      return contents;
    } catch {
      return null;
    }
  }
  const target = durableLocalPath(objectKey);
  return existsSync(target) ? readFileSync(target) : null;
}

export async function putArtifact(key: string, bytes: Uint8Array, mime: string): Promise<string> {
  const bucket = process.env.GCS_BUCKET;
  if (bucket) {
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage({ projectId: getConfig().GOOGLE_CLOUD_PROJECT });
    const objectName = `artifacts/${scopedKey(key)}`;
    const file = storage.bucket(bucket).file(objectName);
    await file.save(bytes, { contentType: mime, resumable: false });
    return `gs://${bucket}/${objectName}`;
  }
  const target = localPath(key);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, bytes);
  return `file://artifacts/${key}`;
}

export async function getArtifact(key: string): Promise<Buffer | null> {
  const bucket = process.env.GCS_BUCKET;
  if (bucket) {
    const { Storage } = await import("@google-cloud/storage");
    const storage = new Storage({ projectId: getConfig().GOOGLE_CLOUD_PROJECT });
    const file = storage.bucket(bucket).file(`artifacts/${scopedKey(key)}`);
    try {
      const [exists] = await file.exists();
      if (!exists) return null;
      const [contents] = await file.download();
      return contents;
    } catch {
      return null;
    }
  }
  const p = localPath(key);
  if (!existsSync(p)) return null;
  return readFileSync(p);
}

export async function deleteArtifactUri(uri: string): Promise<void> {
  const tenant = currentTenant();
  if (uri.startsWith("gs://")) {
    const parsed = new URL(uri);
    const configuredBucket = process.env.GCS_BUCKET;
    const objectName = parsed.pathname.replace(/^\//, "");
    const allowed = [
      `artifacts/${tenant.workspaceId}/${tenant.brandId}/`,
      `chat-attachments/${tenant.workspaceId}/${tenant.brandId}/`,
    ];
    if (!configuredBucket || parsed.hostname !== configuredBucket || !allowed.some((prefix) => objectName.startsWith(prefix))) {
      throw new Error("artifact URI is outside the current tenant storage scope");
    }
    const { Storage } = await import("@google-cloud/storage");
    await new Storage({ projectId: getConfig().GOOGLE_CLOUD_PROJECT })
      .bucket(configuredBucket).file(objectName).delete({ ignoreNotFound: true });
    return;
  }
  if (uri.startsWith("file://artifacts/")) {
    const key = uri.slice("file://artifacts/".length);
    const target = localPath(key);
    if (existsSync(target)) unlinkSync(target);
    return;
  }
  if (uri.startsWith("file://chat-attachments/")) {
    const id = uri.slice("file://chat-attachments/".length);
    const target = localPath(`chat_attachment_${id}`);
    if (existsSync(target)) unlinkSync(target);
    return;
  }
  throw new Error("unsupported artifact URI");
}

export async function deleteWorkspaceArtifactUri(uri: string, workspaceId: string): Promise<void> {
  const tenant = currentTenant();
  if (tenant.workspaceId !== workspaceId) throw new Error("workspace artifact scope mismatch");
  if (!uri.startsWith("gs://")) return deleteArtifactUri(uri);
  const parsed = new URL(uri);
  const configuredBucket = process.env.GCS_BUCKET;
  const objectName = parsed.pathname.replace(/^\//, "");
  const allowed = [
    `artifacts/${workspaceId}/`,
    `chat-attachments/${workspaceId}/`,
  ];
  if (!configuredBucket || parsed.hostname !== configuredBucket || !allowed.some((prefix) => objectName.startsWith(prefix))) {
    throw new Error("artifact URI is outside the current workspace storage scope");
  }
  const { Storage } = await import("@google-cloud/storage");
  await new Storage({ projectId: getConfig().GOOGLE_CLOUD_PROJECT })
    .bucket(configuredBucket).file(objectName).delete({ ignoreNotFound: true });
}
