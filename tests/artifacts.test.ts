import { describe, expect, it } from "vitest";

import {
  artifactDigest,
  artifactObjectKey,
  boundedArtifactRead,
  boundedArtifactReadLines,
  createArtifactRecord,
  validateArtifactBytes,
} from "@/lib/artifacts";

const bytes = Buffer.from("line one\nline two\nline three\n", "utf8");

describe("durable artifacts", () => {
  it("creates tenant-scoped unpredictable object keys without using source filenames", () => {
    expect(artifactObjectKey(
      { workspaceId: "workspace-1", brandId: "brand-1" },
      "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
    )).toBe("durable-artifacts/workspace-1/brand-1/018f47a2-4f40-7b1f-b19f-8f6b916b7d11");
    expect(() => artifactObjectKey(
      { workspaceId: "workspace-1", brandId: "brand-1" },
      "../../secret",
    )).toThrow("invalid artifact id");
  });

  it("builds immutable metadata with digest, preview, trust, and lineage", () => {
    const record = createArtifactRecord({
      id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
      workspaceId: "workspace-1",
      brandId: "brand-1",
      jobId: "job-1",
      operationId: "job:job-1:stage:draft",
      uri: "gs://bucket/durable-artifacts/workspace-1/brand-1/id",
      bytes,
      contentType: "text/plain",
      trust: "external_untrusted",
      sourceEventId: "provider:event-1",
      producer: { kind: "tool", id: "web-search", version: "1" },
      retentionClass: "source",
      now: "2026-08-28T12:00:00.000Z",
    });
    expect(record).toMatchObject({
      sha256: artifactDigest(bytes),
      byteCount: bytes.length,
      lineCount: 4,
      preview: "line one\nline two\nline three\n",
      trust: "external_untrusted",
      state: "writing",
    });
  });

  it("returns bounded byte ranges with resumable offsets", () => {
    const first = boundedArtifactRead(bytes, { offset: 5, length: 8 });
    expect(first.bytes.toString()).toBe("one\nline");
    expect(first).toMatchObject({ offset: 5, nextOffset: 13, complete: false });
    expect(() => boundedArtifactRead(bytes, { offset: 0, length: 65_537 }))
      .toThrow("artifact read exceeds 65536 bytes");
  });

  it("returns bounded line windows without loading them into authority", () => {
    const page = boundedArtifactReadLines(bytes, { lineStart: 1, lineCount: 2 });
    expect(page.text).toBe("line two\nline three");
    expect(page).toMatchObject({ lineStart: 1, nextLine: 3, complete: false });
    expect(() => boundedArtifactReadLines(bytes, { lineStart: 0, lineCount: 201 }))
      .toThrow("artifact line read exceeds 200 lines");
  });

  it("fails closed when stored bytes do not match immutable metadata", () => {
    const record = createArtifactRecord({
      id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
      workspaceId: "workspace-1", brandId: "brand-1", jobId: "job-1",
      operationId: "job:job-1:stage:draft", uri: "file://artifact", bytes,
      contentType: "text/plain", trust: "system",
      producer: { kind: "runtime", id: "context", version: "1" },
      retentionClass: "audit", now: "2026-08-28T12:00:00.000Z",
    });
    expect(() => validateArtifactBytes(record, Buffer.from("tampered")))
      .toThrow("artifact digest mismatch");
  });
});
