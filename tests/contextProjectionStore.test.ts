import { describe, expect, it } from "vitest";

import { servicePrincipal } from "@/lib/authority";
import {
  ContextProjectionStore,
  type ContextProjectionPersistence,
  type ContextProjectionTransaction,
} from "@/lib/contextProjectionStore";
import { createArtifactRecord, type ArtifactRecord } from "@/lib/artifacts";
import {
  contextProjectionManifestDigest,
  createContextProjection,
  renderedContextDigest,
  type ContextProjectionRecord,
} from "@/lib/contextProjections";
import { claimOperation, createOperation, type OperationRecord } from "@/lib/operations";
import { runWithTenant } from "@/lib/tenancy";

const scope = {
  workspaceId: "workspace-1", brandId: "brand-1",
  principal: servicePrincipal("context-projection-test"),
};
const rendered = "# Authority\nNo unapproved publishing.";
const manifest = {
  compilerVersion: "harmonia-context/v1",
  operationId: "job:job-1:stage:draft",
  operationEpoch: 1,
  model: "gemini-3.5-flash",
  goalDigest: "a".repeat(64),
  policyVersion: "policy-1",
  pinnedConstraints: [{ id: "constraint-1", digest: "b".repeat(64) }],
  approvalIds: [], unresolvedEffectIds: [], currentRevisions: [], evidence: [], memory: [],
  recentEventIds: [], artifactRefs: [], maxChars: 16_000,
};
const projection = createContextProjection({
  workspaceId: scope.workspaceId, brandId: scope.brandId, jobId: "job-1", manifest,
  renderedDigest: renderedContextDigest(rendered), renderedChars: rendered.length,
  renderedArtifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d12",
  now: "2026-08-28T12:01:00.000Z",
});

class MemoryPersistence implements ContextProjectionPersistence {
  operation: OperationRecord;
  artifact: ArtifactRecord;
  projection: ContextProjectionRecord | null = null;

  constructor() {
    this.operation = claimOperation(createOperation({
      id: manifest.operationId, workspaceId: scope.workspaceId, brandId: scope.brandId,
      jobId: "job-1", kind: "stage",
      goal: { type: "stage", version: 1, digest: manifest.goalDigest, acceptance: ["persist"] },
      correlationId: "job:job-1", replayPolicy: "safe", maxAttempts: 3,
      now: "2026-08-28T12:00:00.000Z",
    }), {
      ownerId: "worker-1", ownerTokenDigest: "f".repeat(64),
      now: "2026-08-28T12:00:00.000Z", leaseExpiresAt: "2026-08-28T12:10:00.000Z",
    }).operation;
    this.artifact = {
      ...createArtifactRecord({
        id: projection.renderedArtifactId, workspaceId: scope.workspaceId, brandId: scope.brandId,
        jobId: "job-1", operationId: manifest.operationId, uri: "memory://rendered", bytes: Buffer.from(rendered),
        contentType: "text/plain", trust: "system",
        producer: { kind: "runtime", id: "context-compiler", version: "harmonia-context/v1" },
        retentionClass: "audit", now: "2026-08-28T12:00:00.000Z",
      }),
      state: "ready",
    };
  }

  async transact<T>(work: (tx: ContextProjectionTransaction) => Promise<T>): Promise<T> {
    return work({
      getOperation: async () => this.operation,
      getArtifact: async () => this.artifact,
      getProjection: async () => this.projection,
      createProjection: (_path, record) => { this.projection = structuredClone(record); },
      setOperation: (_path, record) => { this.operation = structuredClone(record); },
    });
  }
}

describe("context projection store", () => {
  it("atomically binds a ready rendered artifact and advances the operation pointer", async () => {
    const persistence = new MemoryPersistence();
    const store = new ContextProjectionStore(persistence);
    const result = await runWithTenant(scope, () => store.create(projection, {
      operationId: manifest.operationId,
      workspaceId: scope.workspaceId,
      brandId: scope.brandId,
      epoch: 1,
      now: "2026-08-28T12:02:00.000Z",
    }));
    expect(result).toEqual({ created: true, projection });
    expect(persistence.operation.latestProjectionId).toBe(projection.id);
  });

  it("is idempotent for the exact manifest and rejects artifact or goal substitution", async () => {
    const persistence = new MemoryPersistence();
    const store = new ContextProjectionStore(persistence);
    const fence = {
      operationId: manifest.operationId, workspaceId: scope.workspaceId, brandId: scope.brandId,
      epoch: 1, now: "2026-08-28T12:02:00.000Z",
    };
    await runWithTenant(scope, () => store.create(projection, fence));
    expect(await runWithTenant(scope, () => store.create(projection, fence)))
      .toEqual({ created: false, projection });

    persistence.artifact = { ...persistence.artifact, sha256: "0".repeat(64) };
    persistence.projection = null;
    await expect(runWithTenant(scope, () => store.create(projection, fence)))
      .rejects.toThrow("rendered artifact digest mismatch");

    persistence.artifact = { ...persistence.artifact, sha256: projection.renderedDigest };
    persistence.operation = { ...persistence.operation, goal: { ...persistence.operation.goal, digest: "9".repeat(64) } };
    await expect(runWithTenant(scope, () => store.create(projection, fence)))
      .rejects.toThrow("projection goal digest mismatch");
  });

  it("treats Firestore map key reordering as the same canonical projection", async () => {
    const persistence = new MemoryPersistence();
    const store = new ContextProjectionStore(persistence);
    persistence.projection = Object.fromEntries(
      Object.entries(projection).reverse(),
    ) as unknown as ContextProjectionRecord;
    const result = await runWithTenant(scope, () => store.create(projection, {
      operationId: manifest.operationId, workspaceId: scope.workspaceId, brandId: scope.brandId,
      epoch: 1, now: "2026-08-28T12:02:00.000Z",
    }));
    expect(result.created).toBe(false);
  });

  it("detects record tampering through its canonical manifest digest", () => {
    expect(contextProjectionManifestDigest({ ...manifest, approvalIds: ["approval-2"] }))
      .not.toBe(projection.manifestDigest);
  });
});
