import { describe, expect, it } from "vitest";

import {
  createJobInputSchema,
  jobSourceManifestSchema,
  normalizedSourceSchema,
} from "@/lib/contracts";
import { STAGES } from "@/lib/types";

describe("multisource job contracts", () => {
  const directSources = (count: number) => Array.from({ length: count }, (_, index) => ({
    kind: "pasted_text" as const,
    title: `Note ${index}`,
    text: "Grounded launch evidence",
    rightsAuthorizationId: `rights-${index}`,
  }));

  it("accepts one library snapshot plus ten mixed direct sources", () => {
    const result = createJobInputSchema.parse({
      librarySnapshotId: "snapshot-1",
      directSources: [
        { kind: "youtube", url: "https://www.youtube.com/watch?v=abc123", rightsAuthorizationId: "r-youtube" },
        { kind: "web", url: "https://example.com/launch", rightsAuthorizationId: "r-web" },
        { kind: "upload", attachmentId: "attachment-1", rightsAuthorizationId: "r-upload" },
        ...directSources(7),
      ],
      desiredOutputs: ["x_post"],
    });

    expect(result.directSources).toHaveLength(10);
  });

  it("rejects eleven direct sources", () => {
    expect(() => createJobInputSchema.parse({
      directSources: directSources(11),
      desiredOutputs: ["x_post"],
    })).toThrow();
  });

  it("rejects a job with neither a library nor direct sources", () => {
    expect(() => createJobInputSchema.parse({
      directSources: [],
      desiredOutputs: ["x_post"],
    })).toThrow();
  });

  it("requires typed locators on every normalized segment", () => {
    expect(() => normalizedSourceSchema.parse({
      sourceId: "s1",
      sourceKind: "document",
      title: "Brief",
      mimeType: "application/pdf",
      contentDigest: "a".repeat(64),
      extractorVersion: "pdf-v1",
      extractedAt: new Date().toISOString(),
      extractionReceiptId: "r1",
      metadata: {},
      segments: [{ id: "seg-1", text: "Claim", digest: "b".repeat(64) }],
    })).toThrow();
  });

  it("validates immutable source manifests", () => {
    const result = jobSourceManifestSchema.parse({
      id: "manifest-1",
      jobId: "job-1",
      revision: 1,
      librarySnapshotId: "snapshot-1",
      directSourceIds: ["source-1"],
      excludedSourceIds: [],
      exclusionRecords: [],
      digest: "c".repeat(64),
      sealedAt: new Date().toISOString(),
      sealedBySubjectId: "operator-1",
    });
    expect(result.revision).toBe(1);
  });

  it("uses generalized source collection and extraction stages only", () => {
    expect(STAGES).toContain("collect_sources");
    expect(STAGES).toContain("extract_sources");
    expect(STAGES).toContain("awaiting_source_resolution");
    expect(STAGES).not.toContain("ingest" as never);
    expect(STAGES).not.toContain("transcribe" as never);
  });
});
