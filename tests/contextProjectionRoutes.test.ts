import { beforeEach, describe, expect, it, vi } from "vitest";

const { create, assertDurableOperationFence } = vi.hoisted(() => ({
  create: vi.fn(),
  assertDurableOperationFence: vi.fn(),
}));
vi.mock("@/lib/contextProjectionStore", () => ({
  createContextProjectionStore: () => ({ create }),
}));
vi.mock("@/lib/firestore", () => ({ db: vi.fn(), assertDurableOperationFence }));

import { POST } from "@/app/api/internal/context-projections/route";

const manifest = {
  compilerVersion: "harmonia-context/v1",
  operationId: "job:job-1:stage:draft",
  operationEpoch: 2,
  model: "gemini-3.5-flash",
  goalDigest: "a".repeat(64),
  policyVersion: "policy-1",
  pinnedConstraints: [{ id: "constraint-1", digest: "b".repeat(64) }],
  approvalIds: [], unresolvedEffectIds: [], currentRevisions: [], evidence: [], memory: [],
  recentEventIds: [], artifactRefs: [], maxChars: 16_000,
};

describe("context projection route", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.AGENT_SERVICE_URL = "http://127.0.0.1:8080";
    create.mockReset();
    assertDurableOperationFence.mockReset();
    assertDurableOperationFence.mockResolvedValue({});
    create.mockResolvedValue({ created: true, projection: { id: "projection-1" } });
  });

  it("validates and persists a projection only under its exact epoch fence", async () => {
    const response = await POST(new Request("http://localhost/api/internal/context-projections", {
      method: "POST",
      headers: {
        authorization: "Bearer test-internal-token",
        "content-type": "application/json",
        "x-workspace-id": "workspace-1",
        "x-brand-id": "brand-1",
        "x-harmonia-operation-id": manifest.operationId,
        "x-harmonia-operation-epoch": "2",
      },
      body: JSON.stringify({
        jobId: "job-1",
        manifest,
        renderedDigest: "c".repeat(64),
        renderedChars: 800,
        renderedArtifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d12",
      }),
    }));
    expect(response.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      operationId: manifest.operationId,
      operationEpoch: 2,
      manifestDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
    }), expect.objectContaining({ operationId: manifest.operationId, epoch: 2 }));
  });

  it("rejects a manifest epoch that differs from the live header", async () => {
    const response = await POST(new Request("http://localhost/api/internal/context-projections", {
      method: "POST",
      headers: {
        authorization: "Bearer test-internal-token",
        "content-type": "application/json",
        "x-workspace-id": "workspace-1", "x-brand-id": "brand-1",
        "x-harmonia-operation-id": manifest.operationId,
        "x-harmonia-operation-epoch": "3",
      },
      body: JSON.stringify({
        jobId: "job-1", manifest, renderedDigest: "c".repeat(64), renderedChars: 800,
        renderedArtifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d12",
      }),
    }));
    expect(response.status).toBe(409);
    expect(create).not.toHaveBeenCalled();
  });
});
