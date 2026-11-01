import { describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import {
  ArtifactStore,
  type ArtifactByteStore,
  type ArtifactMetadataStore,
} from "@/lib/artifactStore";
import type { ArtifactRecord } from "@/lib/artifacts";
import { runWithTenant } from "@/lib/tenancy";

const scope = {
  workspaceId: "workspace-1",
  brandId: "brand-1",
  principal: servicePrincipal("artifact-store-test"),
};

class MemoryMetadata implements ArtifactMetadataStore {
  records = new Map<string, ArtifactRecord>();
  async create(path: string, record: ArtifactRecord) {
    if (this.records.has(path)) throw new Error("artifact already exists");
    this.records.set(path, structuredClone(record));
  }
  async set(path: string, record: ArtifactRecord) {
    this.records.set(path, structuredClone(record));
  }
  async get(path: string) {
    return this.records.get(path) ?? null;
  }
}

class MemoryBytes implements ArtifactByteStore {
  objects = new Map<string, Buffer>();
  failWrite = false;
  uri(key: string) { return `memory://${key}`; }
  async put(key: string, bytes: Uint8Array) {
    if (this.failWrite) throw new Error("storage unavailable");
    this.objects.set(key, Buffer.from(bytes));
  }
  async get(key: string) { return this.objects.get(key) ?? null; }
}

const createInput = {
  jobId: "job-1",
  operationId: "job:job-1:stage:draft",
  bytes: Buffer.from("alpha\nbeta\ngamma", "utf8"),
  contentType: "text/plain",
  trust: "provider" as const,
  producer: { kind: "tool", id: "transcript", version: "1" },
  retentionClass: "source" as const,
};

describe("artifact store", () => {
  it("persists intent before bytes and exposes only a ready digest-verified record", async () => {
    const metadata = new MemoryMetadata();
    const objects = new MemoryBytes();
    const store = new ArtifactStore(metadata, objects, {
      id: () => "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
      now: () => "2026-08-28T12:00:00.000Z",
    });
    const record = await runWithTenant(scope, () => store.create(createInput));
    expect(record.state).toBe("ready");
    expect([...objects.objects.keys()][0]).toBe(
      "durable-artifacts/workspace-1/brand-1/018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
    );
    const read = await runWithTenant(scope, () => store.read(record.id, { offset: 0, length: 5 }));
    expect(read.kind).toBe("bytes");
    if (read.kind !== "bytes") throw new Error("expected byte page");
    expect(read.bytes.toString()).toBe("alpha");
  });

  it("preserves a visible failed intent when object storage fails", async () => {
    const metadata = new MemoryMetadata();
    const objects = new MemoryBytes();
    objects.failWrite = true;
    const store = new ArtifactStore(metadata, objects, {
      id: () => "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
      now: () => "2026-08-28T12:00:00.000Z",
    });
    await expect(runWithTenant(scope, () => store.create(createInput))).rejects.toThrow("storage unavailable");
    expect([...metadata.records.values()][0]).toMatchObject({
      state: "failed", failureReason: "artifact byte storage failed (Error)",
    });
  });

  it("materializes complete bytes only after ready-state digest verification", async () => {
    const metadata = new MemoryMetadata();
    const objects = new MemoryBytes();
    const store = new ArtifactStore(metadata, objects, {
      id: () => "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
      now: () => "2026-08-28T12:00:00.000Z",
    });
    const record = await runWithTenant(scope, () => store.create({
      ...createInput,
      bytes: Buffer.from("complete verified source"),
      contentType: "video/mp4",
      rightsAuthorizationId: "license-source-1",
    }));

    expect(record.rightsAuthorizationId).toBe("license-source-1");
    const materialized = await runWithTenant(scope, () => store.materialize(record.id));
    expect(materialized.record).toEqual(record);
    expect(materialized.bytes.toString()).toBe("complete verified source");

    objects.objects.set(
      "durable-artifacts/workspace-1/brand-1/018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
      Buffer.from("tampered"),
    );
    await expect(runWithTenant(scope, () => store.materialize(record.id)))
      .rejects.toThrow("artifact digest mismatch");
  });

  it("rejects cross-tenant metadata and digest-mismatched bytes", async () => {
    const metadata = new MemoryMetadata();
    const objects = new MemoryBytes();
    const store = new ArtifactStore(metadata, objects, {
      id: () => "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
      now: () => "2026-08-28T12:00:00.000Z",
    });
    const record = await runWithTenant(scope, () => store.create(createInput));
    objects.objects.set(
      "durable-artifacts/workspace-1/brand-1/018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
      Buffer.from("tampered"),
    );
    await expect(runWithTenant(scope, () => store.read(record.id, { offset: 0, length: 5 })))
      .rejects.toThrow("artifact digest mismatch");

    const foreign = { ...record, workspaceId: "other-workspace" };
    metadata.records.set(
      "workspaces/workspace-1/artifacts/018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
      foreign,
    );
    await expect(runWithTenant(scope, () => store.get(record.id))).rejects.toThrow("artifact tenant mismatch");
  });
});
