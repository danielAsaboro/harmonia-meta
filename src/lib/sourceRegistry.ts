import { createHash } from "node:crypto";

import type { JobSourceManifest, SourceRecord, SourceState } from "./types";

const TRANSITIONS: Readonly<Record<SourceState, readonly SourceState[]>> = {
  discovered: ["validating", "excluded"],
  validating: ["queued", "failed", "excluded"],
  queued: ["extracting", "failed", "excluded"],
  extracting: ["ready", "failed", "excluded"],
  ready: ["excluded"],
  failed: ["queued", "excluded"],
  excluded: [],
};

export function transitionSource(source: SourceRecord, next: SourceState, updatedAt: string): SourceRecord {
  if (!TRANSITIONS[source.state].includes(next)) {
    throw new Error(`invalid source transition: ${source.state} -> ${next}`);
  }
  const updated = { ...source, state: next, updatedAt };
  if (next !== "failed") delete updated.failure;
  return updated;
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function manifestDigest(manifest: Omit<JobSourceManifest, "digest">): string {
  const payload = {
    id: manifest.id,
    jobId: manifest.jobId,
    revision: manifest.revision,
    librarySnapshotId: manifest.librarySnapshotId ?? null,
    directSourceIds: [...manifest.directSourceIds].sort(),
    excludedSourceIds: [...manifest.excludedSourceIds].sort(),
    exclusionRecords: [...manifest.exclusionRecords]
      .sort((left, right) => left.sourceId.localeCompare(right.sourceId)),
    sealedAt: manifest.sealedAt,
    sealedBySubjectId: manifest.sealedBySubjectId,
  };
  return createHash("sha256").update(JSON.stringify(canonical(payload)), "utf8").digest("hex");
}

export function sealManifest(manifest: Omit<JobSourceManifest, "digest">): JobSourceManifest {
  if (manifest.directSourceIds.length > 10) throw new Error("manifest exceeds ten direct sources");
  if (!manifest.librarySnapshotId && manifest.directSourceIds.length === 0) throw new Error("manifest requires at least one source selection");
  if (new Set(manifest.directSourceIds).size !== manifest.directSourceIds.length) throw new Error("manifest direct sources must be unique");
  const sealed: JobSourceManifest = { ...manifest, digest: manifestDigest(manifest) };
  if (sealed.librarySnapshotId === undefined) delete sealed.librarySnapshotId;
  return sealed;
}
