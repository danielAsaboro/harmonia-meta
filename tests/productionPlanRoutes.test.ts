import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  approveProductionPlan: vi.fn(),
  claimProductionOperation: vi.fn(),
  completeProductionOperation: vi.fn(),
  getProductionOperationArtifact: vi.fn(),
  getProductionSourceArtifact: vi.fn(),
  getProductionPlan: vi.fn(),
  getProductionPlanRevision: vi.fn(),
  proposeProductionPlan: vi.fn(),
  rejectProductionPlan: vi.fn(),
  recordProductionProviderOperation: vi.fn(),
  sealProductionPlan: vi.fn(),
}));
const storage = vi.hoisted(() => ({
  getDurableArtifactObject: vi.fn(),
  putDurableArtifactObject: vi.fn(),
}));
vi.mock("@/lib/productionPlanStore", () => store);
vi.mock("@/lib/auth", () => ({
  administratorTenantHandler: (handler: unknown) => handler,
  operatorTenantHandler: (handler: unknown) => handler,
}));
vi.mock("@/lib/storage", () => storage);

import { POST as propose } from "@/app/api/production-plans/route";
import { POST as revise } from "@/app/api/production-plans/[id]/revisions/route";
import { POST as seal } from "@/app/api/production-plans/[id]/seal/route";
import { POST as decide } from "@/app/api/production-plans/[id]/decision/route";
import { POST as claimInternal } from "@/app/api/internal/production-plans/[id]/operations/[operationId]/claim/route";
import { POST as recordProviderInternal } from "@/app/api/internal/production-plans/[id]/operations/[operationId]/provider/route";
import { POST as uploadArtifactInternal } from "@/app/api/internal/production-plans/[id]/operations/[operationId]/artifact/route";
import { GET as downloadArtifactInternal } from "@/app/api/internal/production-plans/[id]/operations/[operationId]/artifact/route";
import { GET as downloadSourceInternal } from "@/app/api/internal/production-plans/[id]/operations/[operationId]/source/route";

const plan = {
  id: "plan-1", jobId: "job-1", workspaceId: "workspace-1", brandId: "brand-1", revision: 1,
  goal: "Launch reel", audience: "founders", tone: ["clear"],
  target: { platform: "linkedin", durationSec: 30, aspectRatio: "9:16", resolution: "1080p", frameRate: 30, format: "mp4" },
  scenes: [{
    id: "scene-1", order: 1, startSec: 0, durationSec: 4, purpose: "Open",
    video: {
      modelCapability: "veo-3.1-fast", mode: "text_to_video", prompt: "A clean product launch",
      durationSec: 4, aspectRatio: "9:16", resolution: "1080p", generateAudio: false,
      enhancePrompt: true, outputCount: 1,
    },
    overlays: [], captions: [], transitions: [],
  }],
  narration: [],
  constraints: { allowLikeness: false, allowGeneratedVocals: false, requireLicensedSources: true },
  pricingVersion: "2026-08-31",
  operationCostsUsd: { "plan-1:generate_video:scene-1": "0.320000" },
  estimatedCostUsd: "0.320000", maximumCostUsd: "0.320000",
};

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("production plan routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.AGENT_SERVICE_URL = "http://127.0.0.1:8080";
    store.proposeProductionPlan.mockResolvedValue({ id: "plan-1", state: "proposed" });
    store.sealProductionPlan.mockResolvedValue({ id: "plan-1", state: "sealed" });
    store.approveProductionPlan.mockResolvedValue({ id: "plan-1:mandate:v1" });
    store.rejectProductionPlan.mockResolvedValue({ id: "plan-1", state: "rejected" });
    store.claimProductionOperation.mockResolvedValue({ outcome: "execute", claim: { id: "claim-1" } });
    store.recordProductionProviderOperation.mockResolvedValue({ id: "claim-1", state: "waiting_provider" });
    store.completeProductionOperation.mockResolvedValue({ id: "claim-1", state: "succeeded" });
    store.getProductionOperationArtifact.mockResolvedValue({
      objectKey: "durable-artifacts/workspace-1/brand-1/production/plan-1/claim/video.mp4",
      mime: "video/mp4",
      digest: "0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc",
      sizeBytes: 5,
    });
    store.getProductionSourceArtifact.mockResolvedValue({
      record: {
        id: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
        jobId: "job-1",
        contentType: "video/mp4",
        sha256: "0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc",
        byteCount: 5,
        rightsAuthorizationId: "license-source-1",
      },
      bytes: Buffer.from("video"),
    });
    storage.getDurableArtifactObject.mockResolvedValue(Buffer.from("video"));
  });

  it("exposes distinct propose and revise mutations bound to the path plan id", async () => {
    expect((await propose(jsonRequest("http://localhost/api/production-plans", { plan }))).status).toBe(201);
    expect(store.proposeProductionPlan).toHaveBeenNthCalledWith(1, plan);

    const revision = { ...plan, revision: 2 };
    const response = await revise(jsonRequest("http://localhost/api/production-plans/plan-1/revisions", { plan: revision }), {
      params: Promise.resolve({ id: "plan-1" }),
    });
    expect(response.status).toBe(201);
    expect(store.proposeProductionPlan).toHaveBeenNthCalledWith(2, revision);

    const substitutedPlan = {
      ...revision,
      id: "plan-2",
      operationCostsUsd: { "plan-2:generate_video:scene-1": "0.320000" },
    };
    const substituted = await revise(jsonRequest("http://localhost/api/production-plans/plan-1/revisions", { plan: substitutedPlan }), {
      params: Promise.resolve({ id: "plan-1" }),
    });
    expect(substituted.status).toBe(409);
  });

  it("seals and decides only the submitted plan digest", async () => {
    const digest = "a".repeat(64);
    const sealed = await seal(jsonRequest("http://localhost/api/production-plans/plan-1/seal", { planDigest: digest }), {
      params: Promise.resolve({ id: "plan-1" }),
    });
    expect(sealed.status).toBe(200);
    expect(store.sealProductionPlan).toHaveBeenCalledWith("plan-1", { planDigest: digest });

    const approved = await decide(jsonRequest("http://localhost/api/production-plans/plan-1/decision", {
      decision: "approved", planDigest: digest, expiresAt: "2026-08-31T12:00:00.000Z",
    }), { params: Promise.resolve({ id: "plan-1" }) });
    expect(approved.status).toBe(200);
    expect(store.approveProductionPlan).toHaveBeenCalledWith("plan-1", {
      planDigest: digest, expiresAt: "2026-08-31T12:00:00.000Z",
    });

    const rejected = await decide(jsonRequest("http://localhost/api/production-plans/plan-1/decision", {
      decision: "rejected", planDigest: digest, feedback: "Use the source footage instead",
    }), { params: Promise.resolve({ id: "plan-1" }) });
    expect(rejected.status).toBe(200);
    expect(store.rejectProductionPlan).toHaveBeenCalledWith("plan-1", {
      planDigest: digest, feedback: "Use the source footage instead",
    });
  });

  it("requires service authentication before resolving a paid-operation mandate", async () => {
    const url = "http://localhost/api/internal/production-plans/plan-1/operations/operation-1/claim";
    const claim = {
      claimToken: "worker-claim-1",
      expectedPlanRevision: 1,
      expectedPlanDigest: "a".repeat(64),
      expectedInternalRun: 0,
    };
    const unauthorized = await claimInternal(jsonRequest(url, claim), {
      params: Promise.resolve({ id: "plan-1", operationId: "operation-1" }),
    });
    expect(unauthorized.status).toBe(401);

    const authorized = await claimInternal(jsonRequest(url, claim, {
      authorization: "Bearer test-internal-token",
      "x-workspace-id": "workspace-1",
      "x-brand-id": "brand-1",
    }), { params: Promise.resolve({ id: "plan-1", operationId: "operation-1" }) });
    expect(authorized.status).toBe(200);
    expect(store.claimProductionOperation).toHaveBeenCalledWith("plan-1", "operation-1", claim);
  });

  it("records the provider identity through a distinct service-only transition", async () => {
    const body = {
      claimId: "claim-1",
      claimToken: "worker-claim-1",
      provider: "veo",
      providerOperationId: "projects/p/locations/us-central1/operations/1",
      nextPollAt: "2026-08-31T12:00:00.000Z",
    };
    const response = await recordProviderInternal(jsonRequest(
      "http://localhost/api/internal/production-plans/plan-1/operations/operation-1/provider",
      body,
      {
        authorization: "Bearer test-internal-token",
        "x-workspace-id": "workspace-1",
        "x-brand-id": "brand-1",
      },
    ), { params: Promise.resolve({ id: "plan-1", operationId: "operation-1" }) });
    expect(response.status).toBe(200);
    expect(store.recordProductionProviderOperation).toHaveBeenCalledWith("plan-1", "operation-1", body);
  });

  it("accepts only digest-matching production bytes and completes the owned claim", async () => {
    const bytes = new TextEncoder().encode("video");
    const digest = "0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc";
    const request = new Request(
      "http://localhost/api/internal/production-plans/plan-1/operations/operation-1/artifact",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-internal-token",
          "x-workspace-id": "workspace-1",
          "x-brand-id": "brand-1",
          "x-claim-id": "claim-1",
          "x-claim-token": "worker-claim-1",
          "x-artifact-mime": "video/mp4",
          "x-artifact-digest": digest,
          "x-operation-metadata": JSON.stringify({ model: "veo-3.1-fast-generate-001" }),
        },
        body: bytes,
      },
    );
    const response = await uploadArtifactInternal(request, {
      params: Promise.resolve({ id: "plan-1", operationId: "operation-1" }),
    });
    expect(response.status).toBe(200);
    expect(store.completeProductionOperation).toHaveBeenCalledWith(
      "plan-1",
      "operation-1",
      expect.objectContaining({
        claimId: "claim-1",
        claimToken: "worker-claim-1",
        artifact: expect.objectContaining({ mime: "video/mp4", digest, sizeBytes: 5 }),
        operationMetadata: { model: "veo-3.1-fast-generate-001" },
      }),
    );
  });

  it("persists a verified conditioning image as a durable production artifact", async () => {
    const bytes = new TextEncoder().encode("image");
    const digest = "6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d";
    const response = await uploadArtifactInternal(new Request(
      "http://localhost/api/internal/production-plans/plan-1/operations/resolve-frame/artifact",
      {
        method: "POST",
        headers: {
          authorization: "Bearer test-internal-token",
          "x-workspace-id": "workspace-1",
          "x-brand-id": "brand-1",
          "x-claim-id": "claim-frame",
          "x-claim-token": "worker-frame",
          "x-artifact-mime": "image/png",
          "x-artifact-digest": digest,
          "x-operation-metadata": JSON.stringify({ kind: "verified_source_materialization" }),
        },
        body: bytes,
      },
    ), { params: Promise.resolve({ id: "plan-1", operationId: "resolve-frame" }) });

    expect(response.status).toBe(200);
    expect(storage.putDurableArtifactObject).toHaveBeenCalledWith(
      expect.stringMatching(new RegExp(`/claim-frame/${digest}\\.png$`)),
      bytes,
      "image/png",
    );
    expect(store.completeProductionOperation).toHaveBeenCalledWith(
      "plan-1",
      "resolve-frame",
      expect.objectContaining({ artifact: expect.objectContaining({ mime: "image/png", digest }) }),
    );
  });

  it("downloads only the current succeeded artifact after server-side digest verification", async () => {
    const response = await downloadArtifactInternal(new Request(
      "http://localhost/api/internal/production-plans/plan-1/operations/operation-1/artifact",
      {
        headers: {
          authorization: "Bearer test-internal-token",
          "x-workspace-id": "workspace-1",
          "x-brand-id": "brand-1",
        },
      },
    ), { params: Promise.resolve({ id: "plan-1", operationId: "operation-1" }) });
    expect(response.status).toBe(200);
    expect(response.headers.get("x-artifact-digest")).toBe(
      "0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc",
    );
    expect(await response.text()).toBe("video");
  });

  it("materializes source bytes only through the exact owned resolve-media claim", async () => {
    const request = new Request(
      "http://localhost/api/internal/production-plans/plan-1/operations/plan-1:resolve_media:source/source",
      {
        headers: {
          authorization: "Bearer test-internal-token",
          "x-workspace-id": "workspace-1",
          "x-brand-id": "brand-1",
          "x-claim-id": "resolve-claim-1",
          "x-claim-token": "worker-resolve-1",
        },
      },
    );
    const response = await downloadSourceInternal(request, {
      params: Promise.resolve({ id: "plan-1", operationId: "plan-1:resolve_media:source" }),
    });

    expect(response.status).toBe(200);
    expect(store.getProductionSourceArtifact).toHaveBeenCalledWith(
      "plan-1",
      "plan-1:resolve_media:source",
      { claimId: "resolve-claim-1", claimToken: "worker-resolve-1" },
    );
    expect(response.headers.get("content-type")).toBe("video/mp4");
    expect(response.headers.get("x-artifact-digest")).toBe(
      "0cab1c9617404faf2b24e221e189ca5945813e14d3f766345b09ca13bbe28ffc",
    );
    expect(await response.text()).toBe("video");
  });
});
