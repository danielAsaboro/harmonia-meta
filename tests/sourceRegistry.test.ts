import { describe, expect, it } from "vitest";

import { manifestDigest, transitionSource } from "@/lib/sourceRegistry";
import type { JobSourceManifest, SourceRecord } from "@/lib/types";

const source = (state: SourceRecord["state"]): SourceRecord => ({
  id: "source-1", workspaceId: "workspace-1", brandId: "brand-1", provider: "pasted_text",
  providerResourceId: "note-1", providerVersion: "digest-1", title: "Launch note", mimeType: "text/plain",
  state, rightsAuthorizationId: "rights-1", trust: "operator_supplied",
  createdAt: "2026-08-30T00:00:00.000Z", updatedAt: "2026-08-30T00:00:00.000Z",
});

const manifest = (directSourceIds: string[]): Omit<JobSourceManifest, "digest"> => ({
  id: "manifest-1", jobId: "job-1", revision: 1, librarySnapshotId: "snapshot-1",
  directSourceIds, excludedSourceIds: [], exclusionRecords: [],
  sealedAt: "2026-08-30T00:00:00.000Z", sealedBySubjectId: "operator-1",
});

describe("source registry state", () => {
  it("does not move a ready source back to extracting", () => {
    expect(() => transitionSource(source("ready"), "extracting", "2026-08-30T01:00:00.000Z"))
      .toThrow("invalid source transition");
  });

  it("allows the explicit extraction progression", () => {
    const validating = transitionSource(source("discovered"), "validating", "2026-08-30T00:01:00.000Z");
    const queued = transitionSource(validating, "queued", "2026-08-30T00:02:00.000Z");
    expect(transitionSource(queued, "extracting", "2026-08-30T00:03:00.000Z").state).toBe("extracting");
  });

  it("seals a canonical manifest digest independent of direct-source order", () => {
    expect(manifestDigest(manifest(["a", "b"]))).toBe(manifestDigest(manifest(["b", "a"])));
  });

  it("binds the digest to exclusions and revision", () => {
    const base = manifest(["a"]);
    expect(manifestDigest(base)).not.toBe(manifestDigest({ ...base, revision: 2 }));
    expect(manifestDigest(base)).not.toBe(manifestDigest({ ...base, excludedSourceIds: ["x"] }));
  });
});
