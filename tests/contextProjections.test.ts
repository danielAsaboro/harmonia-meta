import { describe, expect, it } from "vitest";

import {
  contextProjectionId,
  contextProjectionManifestDigest,
  createContextProjection,
  renderedContextDigest,
  type ContextProjectionManifest,
} from "@/lib/contextProjections";

const manifest: ContextProjectionManifest = {
  compilerVersion: "harmonia-context/v1",
  operationId: "job:job-1:stage:draft",
  operationEpoch: 2,
  model: "gemini-3.5-flash",
  goalDigest: "a".repeat(64),
  policyVersion: "policy-2026-08-28",
  pinnedConstraints: [{ id: "constraint:no-publish", digest: "b".repeat(64) }],
  approvalIds: ["approval-1"],
  unresolvedEffectIds: ["command-1"],
  currentRevisions: [{ kind: "strategy", id: "strategy-1", revision: 2, digest: "c".repeat(64) }],
  evidence: [{ id: "payload", trust: "system", digest: "d".repeat(64), artifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11" }],
  memory: [{ id: "memory-1", digest: "e".repeat(64), evidenceRef: "jobs/job-0/verification/v1" }],
  recentEventIds: ["event-1"],
  artifactRefs: ["018f47a2-4f40-7b1f-b19f-8f6b916b7d11"],
  maxChars: 16_000,
};

describe("context projection contracts", () => {
  it("canonicalizes manifests independently of object key order", () => {
    const reordered = Object.fromEntries(Object.entries(manifest).reverse()) as unknown as ContextProjectionManifest;
    expect(contextProjectionManifestDigest(reordered)).toBe(contextProjectionManifestDigest(manifest));
  });

  it("derives a deterministic projection identity from operation epoch and manifest", () => {
    const digest = contextProjectionManifestDigest(manifest);
    expect(contextProjectionId(manifest.operationId, manifest.operationEpoch, digest))
      .toBe(contextProjectionId(manifest.operationId, manifest.operationEpoch, digest));
    expect(contextProjectionId(manifest.operationId, 3, digest))
      .not.toBe(contextProjectionId(manifest.operationId, 2, digest));
  });

  it("creates a queryable record whose rendered context remains artifact-backed", () => {
    const rendered = "# Authority\nNever publish without approval.";
    const record = createContextProjection({
      workspaceId: "workspace-1",
      brandId: "brand-1",
      jobId: "job-1",
      manifest,
      renderedDigest: renderedContextDigest(rendered),
      renderedChars: rendered.length,
      renderedArtifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d12",
      now: "2026-08-28T12:00:00.000Z",
    });
    expect(record).toMatchObject({
      id: contextProjectionId(manifest.operationId, 2, contextProjectionManifestDigest(manifest)),
      compilerVersion: "harmonia-context/v1",
      operationEpoch: 2,
      approvalIds: ["approval-1"],
      unresolvedEffectIds: ["command-1"],
      renderedDigest: renderedContextDigest(rendered),
      renderedArtifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d12",
    });
  });

  it("rejects malformed digests and over-budget render claims", () => {
    expect(() => createContextProjection({
      workspaceId: "workspace-1", brandId: "brand-1", jobId: "job-1",
      manifest,
      renderedDigest: "not-a-digest",
      renderedChars: manifest.maxChars + 1,
      renderedArtifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d12",
      now: "2026-08-28T12:00:00.000Z",
    })).toThrow();
  });

  it("matches the Python compiler's canonical manifest digest and projection id", () => {
    const pythonManifest: ContextProjectionManifest = {
      compilerVersion: "harmonia-context/v1",
      operationId: "job:job-1:stage:draft",
      operationEpoch: 3,
      model: "gemini-3.5-flash",
      goalDigest: "a".repeat(64),
      policyVersion: "policy-1",
      pinnedConstraints: [
        { id: "constraint:no-memory-authority", digest: "1c43dd719e82fcc05d02753e286467481485d97bacc081eadb583286fc7cd63b" },
        { id: "constraint:no-publish", digest: "c9f2457f36fc6010a7af4902b87a7cc30a2c393b2570014144e09960c42ab02e" },
      ],
      approvalIds: ["approval-1"],
      unresolvedEffectIds: ["command-1"],
      currentRevisions: [{ kind: "strategy", id: "strategy-1", revision: 2, digest: "c".repeat(64) }],
      evidence: [
        { id: "external-search", trust: "external_untrusted", digest: "81feb0af22bdba9b2ba001aea108f4155e25936a78443f8a970fcee97c6d04f4", artifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11" },
        { id: "operator-brief", trust: "operator", digest: "4cc634048c219409a4c34d0a36a2d06efdd37cedd409d4ab9fae1c19a3315149" },
      ],
      memory: [{ id: "memory-1", digest: "4992133d8afc07372387e87a146b203841977546d8a622227804739ea304fa62", evidenceRef: "jobs/job-0/decision/d1" }],
      recentEventIds: ["event-1", "event-2"],
      artifactRefs: ["018f47a2-4f40-7b1f-b19f-8f6b916b7d11"],
      maxChars: 2400,
    };
    const digest = contextProjectionManifestDigest(pythonManifest);
    expect(digest).toBe("5681816d3dce6443ed71f724d9f232caaf558ba1f8a40b80f9a86753a092be8a");
    expect(contextProjectionId(pythonManifest.operationId, 3, digest))
      .toBe("87576aee6a41ca6687140064afa359cb5e9754538a9a5555e9417329f3b3106b");
  });
});
