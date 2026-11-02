import { afterAll, describe, expect, it } from "vitest";

import { firebasePrincipal, servicePrincipal } from "@/lib/authority";
import { createArtifactStore } from "@/lib/artifactStore";
import { db } from "@/lib/firestore";
import { compileProductionOperations, createProductionMandate, generatedMusicSpecSchema, generatedVideoSpecSchema, productionPlanDigest, videoProductionPlanSchema } from "@/lib/mediaProduction";
import {
  approveProductionPlan,
  claimPaidProductionOperation,
  claimProductionOperation,
  claimProductionOutbox,
  completePaidProductionOperation,
  completeInternalProductionOperation,
  finalizeProductionOutboxPublish,
  getProductionPlan,
  getProductionPlanWorkspaceForJob,
  getProductionPlanRevision,
  getProductionSourceArtifact,
  listDispatchableProductionOutbox,
  proposeProductionPlan,
  rejectProductionPlan,
  recordProductionProviderOperation,
  requestProductionRerender,
  startProductionProviderSubmission,
  sealProductionPlan,
} from "@/lib/productionPlanStore";
import { runWithTenant } from "@/lib/tenancy";

const emulator = process.env.FIRESTORE_EMULATOR_HOST;
const workspaceId = "production-plan-test";
const brandId = "brand-test";
const operatorScope = {
  workspaceId,
  brandId,
  principal: firebasePrincipal({
    subjectId: "operator-test",
    workspaceRole: "owner",
    authenticationId: "firebase-production-test",
  }),
};
const serviceScope = {
  workspaceId,
  brandId,
  principal: servicePrincipal("production-claim-test"),
};
const jobId = `production-${Date.now()}`;
const videoSpec = generatedVideoSpecSchema.parse({ modelCapability: "veo-3.1-fast", mode: "text_to_video", prompt: "Calm blue network", durationSec: 4, aspectRatio: "9:16", resolution: "1080p", generateAudio: false, enhancePrompt: true, outputCount: 1 });
const musicSpec = generatedMusicSpecSchema.parse({ modelCapability: "lyria-3-clip", prompt: "Warm minimal electronic soundtrack", instrumental: true, lyricsMode: "none", language: "en", targetDurationSec: 30, outputCount: 1 });
const basePlan = videoProductionPlanSchema.parse({
  id: "plan-1",
  jobId,
  workspaceId,
  brandId,
  revision: 1,
  goal: "Create a product launch reel",
  audience: "technical startup founders",
  tone: ["confident", "clear"],
  target: { platform: "linkedin", durationSec: 30, aspectRatio: "9:16", resolution: "1080p", frameRate: 30, format: "mp4" },
  scenes: [{
    id: "scene-1", order: 1, startSec: 0, durationSec: 4,
    purpose: "establish the product",
    video: videoSpec,
    overlays: [], captions: [], transitions: [],
  }],
  narration: [],
  soundtrack: musicSpec,
  constraints: { allowLikeness: false, allowGeneratedVocals: false, requireLicensedSources: true },
  pricingVersion: "2026-08-31",
  operationCostsUsd: {
    "plan-1:generate_video:scene-1": "0.320000",
    "plan-1:generate_music": "0.120000",
  },
  estimatedCostUsd: "0.440000",
  maximumCostUsd: "0.500000",
});

function wake(plan: typeof basePlan, claimToken: string, expectedInternalRun = 0) {
  return {
    claimToken,
    expectedPlanRevision: plan.revision,
    expectedPlanDigest: productionPlanDigest(plan),
    expectedInternalRun,
  };
}

describe.skipIf(!emulator)("production plan Firestore aggregate", () => {
  it("persists plans with explicitly undefined optional media fields", async () => {
    const optionalJobId = `production-optional-${Date.now()}`;
    const optionalPlanId = `plan-optional-${Date.now()}`;
    await db().doc(`workspaces/${workspaceId}`).set({ defaultBrandId: brandId });
    await db().doc(`workspaces/${workspaceId}/jobs/${optionalJobId}`).set({
      id: optionalJobId, workspaceId, brandId, status: "active", stage: "draft",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const plan = videoProductionPlanSchema.parse({
      ...basePlan,
      id: optionalPlanId,
      jobId: optionalJobId,
      soundtrack: undefined,
      operationCostsUsd: { [`${optionalPlanId}:generate_video:scene-1`]: "0.320000" },
      estimatedCostUsd: "0.320000",
      maximumCostUsd: "0.320000",
    });
    await expect(runWithTenant(operatorScope, () => proposeProductionPlan(plan))).resolves.toMatchObject({
      id: optionalPlanId,
      state: "proposed",
    });
    const persisted = await runWithTenant(operatorScope, () => getProductionPlanRevision(optionalPlanId, 1));
    expect(persisted?.plan).not.toHaveProperty("soundtrack");
  });

  it("schedules and materializes a digest- and rights-bound source operation", async () => {
    const sourceJobId = `production-source-${Date.now()}`;
    const sourcePlanId = `plan-source-${Date.now()}`;
    await db().doc(`workspaces/${workspaceId}`).set({ defaultBrandId: brandId });
    await db().doc(`workspaces/${workspaceId}/jobs/${sourceJobId}`).set({
      id: sourceJobId, workspaceId, brandId, status: "active", stage: "draft",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const source = await runWithTenant(serviceScope, () => createArtifactStore(db()).create({
      jobId: sourceJobId,
      operationId: `${sourceJobId}:ingest_source`,
      bytes: Buffer.from("verified-source-video"),
      contentType: "video/mp4",
      trust: "operator",
      producer: { kind: "operator_upload", id: "source-upload-1", version: "1" },
      retentionClass: "source",
      rightsAuthorizationId: "license-source-1",
    }));
    const { video: _generatedVideo, ...sourceScene } = basePlan.scenes[0];
    void _generatedVideo;
    const { soundtrack: _generatedSoundtrack, ...sourceOnlyBase } = basePlan;
    void _generatedSoundtrack;
    const sealedPlan = videoProductionPlanSchema.parse({
      ...sourceOnlyBase,
      id: sourcePlanId,
      jobId: sourceJobId,
      target: { ...basePlan.target, durationSec: 4 },
      scenes: [{
        ...sourceScene,
        sourceWindow: { startSec: 0, durationSec: 4 },
        sourceSegmentRefs: ["segment-source-1"],
        preserveSourceAudio: true,
        reframe: { xPercent: 50, yPercent: 50, scale: 1 },
        sourceArtifact: {
          artifactId: source.id,
          digest: source.sha256,
          mime: source.contentType,
          sizeBytes: source.byteCount,
          rightsAuthorizationId: source.rightsAuthorizationId,
        },
      }],
      operationCostsUsd: {},
      estimatedCostUsd: "0.000000",
      maximumCostUsd: "0.000000",
    });
    await runWithTenant(serviceScope, () => proposeProductionPlan(sealedPlan));
    await runWithTenant(operatorScope, () => sealProductionPlan(sealedPlan.id, {
      planDigest: productionPlanDigest(sealedPlan),
    }));
    expect(await runWithTenant(operatorScope, () => approveProductionPlan(sealedPlan.id, {
      planDigest: productionPlanDigest(sealedPlan),
      expiresAt: "2099-01-01T00:00:00.000Z",
    }))).toBeNull();
    const resolve = compileProductionOperations(sealedPlan).find((item) => item.type === "resolve_media")!;
    expect(await runWithTenant(serviceScope, () => listDispatchableProductionOutbox(
      100, new Date("2098-01-01T00:00:00.000Z"),
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({ planId: sealedPlan.id, operationId: resolve.id, state: "pending" }),
    ]));
    const claimed = await runWithTenant(serviceScope, () => claimProductionOperation(
      sealedPlan.id, resolve.id, wake(sealedPlan, "source-worker"),
    ));
    expect(claimed).toMatchObject({ outcome: "execute", claim: { kind: "internal" } });
    const materialized = await runWithTenant(serviceScope, () => getProductionSourceArtifact(
      sealedPlan.id,
      resolve.id,
      { claimId: claimed.claim.id, claimToken: "source-worker" },
    ));
    expect(materialized.record).toMatchObject({
      id: source.id,
      sha256: source.sha256,
      rightsAuthorizationId: "license-source-1",
    });
    expect(materialized.bytes.toString()).toBe("verified-source-video");
    await expect(runWithTenant(serviceScope, () => getProductionSourceArtifact(
      sealedPlan.id,
      resolve.id,
      { claimId: claimed.claim.id, claimToken: "wrong-worker" },
    ))).rejects.toThrow(/ownership/i);
  });

  it("does not claim paid Veo conditioning until the exact resolver artifact succeeds", async () => {
    const unique = Date.now();
    const conditionedJobId = `production-conditioned-${unique}`;
    const conditionedPlanId = `plan-conditioned-${unique}`;
    await db().doc(`workspaces/${workspaceId}`).set({ defaultBrandId: brandId });
    await db().doc(`workspaces/${workspaceId}/jobs/${conditionedJobId}`).set({
      id: conditionedJobId, workspaceId, brandId, status: "active", stage: "draft",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    const image = await runWithTenant(serviceScope, () => createArtifactStore(db()).create({
      jobId: conditionedJobId,
      operationId: `${conditionedJobId}:ingest_conditioning`,
      bytes: Buffer.from("verified-png-conditioning"),
      contentType: "image/png",
      trust: "operator",
      producer: { kind: "operator_upload", id: "conditioning-upload-1", version: "1" },
      retentionClass: "source",
      rightsAuthorizationId: "license-conditioning-1",
    }));
    const conditionedPlan = videoProductionPlanSchema.parse({
      ...basePlan,
      id: conditionedPlanId,
      jobId: conditionedJobId,
      scenes: [{
        ...basePlan.scenes[0],
        video: {
          ...basePlan.scenes[0].video,
          mode: "image_to_video",
          sourceImageArtifact: {
            artifactId: image.id,
            digest: image.sha256,
            mime: image.contentType,
            sizeBytes: image.byteCount,
            rightsAuthorizationId: image.rightsAuthorizationId,
          },
        },
      }],
      operationCostsUsd: {
        [`${conditionedPlanId}:generate_video:scene-1`]: "0.320000",
        [`${conditionedPlanId}:generate_music`]: "0.120000",
      },
    });
    await runWithTenant(serviceScope, () => proposeProductionPlan(conditionedPlan));
    await runWithTenant(operatorScope, () => sealProductionPlan(conditionedPlan.id, {
      planDigest: productionPlanDigest(conditionedPlan),
    }));
    await runWithTenant(operatorScope, () => approveProductionPlan(conditionedPlan.id, {
      planDigest: productionPlanDigest(conditionedPlan),
      expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    const operations = compileProductionOperations(conditionedPlan);
    const resolve = operations.find((operation) => operation.type === "resolve_media")!;
    const paid = operations.find((operation) => operation.type === "generate_video")!;
    expect(await runWithTenant(serviceScope, () => listDispatchableProductionOutbox(
      100, new Date("2098-01-01T00:00:00.000Z"),
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({ planId: conditionedPlan.id, operationId: resolve.id, state: "pending" }),
    ]));
    await expect(runWithTenant(serviceScope, () => claimPaidProductionOperation(
      conditionedPlan.id, paid.id, wake(conditionedPlan, "too-early-paid-worker"),
    ))).rejects.toThrow(/dependency.*incomplete/i);

    const resolved = await runWithTenant(serviceScope, () => claimProductionOperation(
      conditionedPlan.id, resolve.id, wake(conditionedPlan, "conditioning-resolver"),
    ));
    await runWithTenant(serviceScope, () => completeInternalProductionOperation(
      conditionedPlan.id, resolve.id, {
        claimId: resolved.claim.id,
        claimToken: "conditioning-resolver",
        artifact: {
          objectKey: `durable-artifacts/${workspaceId}/${brandId}/production/${conditionedPlan.id}/conditioning.png`,
          mime: "image/png",
          digest: image.sha256,
          sizeBytes: image.byteCount,
        },
        operationMetadata: { kind: "verified_source_materialization", artifactId: image.id },
      },
    ));
    expect(await runWithTenant(serviceScope, () => listDispatchableProductionOutbox(
      100, new Date("2098-01-01T00:00:00.000Z"),
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({ planId: conditionedPlan.id, operationId: paid.id, state: "pending" }),
    ]));
    const paidClaim = await runWithTenant(serviceScope, () => claimPaidProductionOperation(
      conditionedPlan.id, paid.id, wake(conditionedPlan, "conditioned-paid-worker"),
    ));
    expect(paidClaim).toMatchObject({
      outcome: "execute",
      claim: {
        kind: "paid",
        inputDigests: [{ operationId: resolve.id, digest: image.sha256 }],
      },
      inputs: [{
        operationId: resolve.id,
        artifact: { mime: "image/png", digest: image.sha256, sizeBytes: image.byteCount },
      }],
    });
  });

  it("transactionally rejects a second production plan identity for one job", async () => {
    const unique = Date.now();
    const jobId = `production-cardinality-${unique}`;
    const first = videoProductionPlanSchema.parse({
      ...basePlan,
      id: `plan-cardinality-a-${unique}`,
      jobId,
      operationCostsUsd: {
        [`plan-cardinality-a-${unique}:generate_video:scene-1`]: "0.320000",
        [`plan-cardinality-a-${unique}:generate_music`]: "0.120000",
      },
    });
    const second = videoProductionPlanSchema.parse({
      ...first,
      id: `plan-cardinality-b-${unique}`,
      operationCostsUsd: {
        [`plan-cardinality-b-${unique}:generate_video:scene-1`]: "0.320000",
        [`plan-cardinality-b-${unique}:generate_music`]: "0.120000",
      },
    });
    await db().doc(`workspaces/${workspaceId}`).set({ defaultBrandId: brandId });
    await db().doc(`workspaces/${workspaceId}/jobs/${jobId}`).set({
      id: jobId, workspaceId, brandId, status: "active", stage: "publish",
      config: { sourceManifestId: "manifest-1", desiredOutputs: [], allowedOutputs: [], platforms: [] },
      actions: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    });
    await runWithTenant(operatorScope, () => proposeProductionPlan(first));
    await expect(runWithTenant(operatorScope, () => proposeProductionPlan(second)))
      .rejects.toThrow(/already bound/i);
  });

  it("atomically schedules and claims a cost-free composition after paid dependencies succeed", async () => {
    const internalJobId = `production-internal-${Date.now()}`;
    const { soundtrack: _soundtrack, ...planWithoutSoundtrack } = basePlan;
    void _soundtrack;
    const internalPlan = videoProductionPlanSchema.parse({
      ...planWithoutSoundtrack,
      id: "plan-internal",
      jobId: internalJobId,
      operationCostsUsd: { "plan-internal:generate_video:scene-1": "0.320000" },
      estimatedCostUsd: "0.320000",
    });
    await db().doc(`workspaces/${workspaceId}`).set({ defaultBrandId: brandId });
    await db().doc(`workspaces/${workspaceId}/jobs/${internalJobId}`).set({
      workspaceId, brandId, status: "running", stage: "draft",
      createdAt: "2026-08-31T09:00:00.000Z", updatedAt: "2026-08-31T09:00:00.000Z",
    });
    await runWithTenant(serviceScope, () => proposeProductionPlan(internalPlan));
    await runWithTenant(operatorScope, () => sealProductionPlan(internalPlan.id, {
      planDigest: productionPlanDigest(internalPlan),
    }));
    await runWithTenant(operatorScope, () => approveProductionPlan(internalPlan.id, {
      planDigest: productionPlanDigest(internalPlan),
      expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    const paid = compileProductionOperations(internalPlan).find((item) => item.type === "generate_video")!;
    const paidClaim = await runWithTenant(serviceScope, () => claimProductionOperation(
      internalPlan.id, paid.id, wake(internalPlan, "internal-paid-worker"),
    ));
    expect(paidClaim).toMatchObject({ outcome: "execute", claim: { kind: "paid" } });
    await runWithTenant(serviceScope, () => startProductionProviderSubmission(
      internalPlan.id, paid.id, {
        claimId: paidClaim.claim.id, claimToken: "internal-paid-worker", provider: "veo",
      },
    ));
    await runWithTenant(serviceScope, () => recordProductionProviderOperation(
      internalPlan.id, paid.id, {
        claimId: paidClaim.claim.id,
        claimToken: "internal-paid-worker",
        provider: "veo",
        providerOperationId: "operations/internal-video",
        nextPollAt: "2098-01-01T00:00:00.000Z",
      },
    ));
    await runWithTenant(serviceScope, () => completePaidProductionOperation(
      internalPlan.id, paid.id, {
        claimId: paidClaim.claim.id,
        claimToken: "internal-paid-worker",
        artifact: {
          objectKey: `durable-artifacts/${workspaceId}/${brandId}/production/plan-internal/video.mp4`,
          mime: "video/mp4",
          digest: "e".repeat(64),
          sizeBytes: 100,
        },
        providerMetadata: { provider: "veo", providerOperationId: "operations/internal-video" },
      },
    ));
    const build = compileProductionOperations(internalPlan).find((item) => item.type === "build_composition")!;
    expect(await runWithTenant(serviceScope, () => listDispatchableProductionOutbox(
      100, new Date("2098-01-02T00:00:00.000Z"),
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({ planId: internalPlan.id, operationId: build.id, state: "pending" }),
    ]));
    const buildClaim = await runWithTenant(serviceScope, () => claimProductionOperation(
      internalPlan.id, build.id, wake(internalPlan, "internal-build-worker"),
    ));
    expect(buildClaim).toMatchObject({
      outcome: "execute",
      claim: { kind: "internal", operationId: build.id },
      operation: { type: "build_composition" },
      plan: { id: internalPlan.id },
      inputs: [{ operationId: paid.id, artifact: { digest: "e".repeat(64) } }],
    });
    await runWithTenant(serviceScope, () => completeInternalProductionOperation(
      internalPlan.id, build.id, {
        claimId: buildClaim.claim.id,
        claimToken: "internal-build-worker",
        artifact: {
          objectKey: `durable-artifacts/${workspaceId}/${brandId}/production/plan-internal/composition.zip`,
          mime: "application/zip", digest: "1".repeat(64), sizeBytes: 100,
        },
        operationMetadata: { kind: "composition_workspace" },
      },
    ));
    for (const [index, type] of [
      "render_composition", "mix_audio", "ffmpeg_finalize", "inspect_media", "evaluate_production",
      "repair_media", "inspect_delivery", "evaluate_delivery",
    ].entries()) {
      const operation = compileProductionOperations(internalPlan).find((item) => item.type === type)!;
      const token = `internal-chain-worker-${index}`;
      const claimed = await runWithTenant(serviceScope, () => claimProductionOperation(
        internalPlan.id, operation.id, wake(internalPlan, token),
      ));
      expect(claimed).toMatchObject({ outcome: "execute", claim: { kind: "internal" } });
      const json = type === "inspect_media" || type === "evaluate_production"
        || type === "inspect_delivery" || type === "evaluate_delivery";
      await runWithTenant(serviceScope, () => completeInternalProductionOperation(
        internalPlan.id, operation.id, {
          claimId: claimed.claim.id,
          claimToken: token,
          artifact: {
            objectKey: `durable-artifacts/${workspaceId}/${brandId}/production/plan-internal/${type}.${json ? "json" : "mp4"}`,
            mime: json ? "application/json" : "video/mp4",
            digest: String(index + 2).repeat(64),
            sizeBytes: 100,
          },
          operationMetadata: { kind: type },
        },
      ));
    }
    const assemble = compileProductionOperations(internalPlan).find((item) => item.type === "assemble_export")!;
    const assembleClaim = await runWithTenant(serviceScope, () => claimProductionOperation(
      internalPlan.id, assemble.id, wake(internalPlan, "internal-export-worker"),
    ));
    expect(assembleClaim).toMatchObject({
      outcome: "execute",
      inputs: [
        { operationId: "plan-internal:repair_media" },
        { operationId: "plan-internal:evaluate_delivery" },
      ],
    });
    const aggregateRef = db().doc(`workspaces/${workspaceId}/brands/${brandId}/production_plans/${internalPlan.id}`);
    await aggregateRef.update({ currentRevision: 2, currentPlanDigest: "f".repeat(64), internalRun: 0 });
    await expect(runWithTenant(serviceScope, () => completeInternalProductionOperation(
      internalPlan.id, assemble.id, {
        claimId: assembleClaim.claim.id,
        claimToken: "internal-export-worker",
        artifact: {
          objectKey: `durable-artifacts/${workspaceId}/${brandId}/production/plan-internal/stale-revision.zip`,
          mime: "application/zip", digest: "f".repeat(64), sizeBytes: 100,
        },
        operationMetadata: { kind: "stale_revision_export" },
      },
    ))).rejects.toThrow(/superseded by a newer plan revision or render run/i);
    await aggregateRef.update({
      currentRevision: internalPlan.revision,
      currentPlanDigest: productionPlanDigest(internalPlan),
      internalRun: 0,
    });
    const workspace = await runWithTenant(operatorScope, () => getProductionPlanWorkspaceForJob(internalJobId));
    expect(workspace).toMatchObject({
      aggregate: { id: internalPlan.id, jobId: internalJobId, state: "approved" },
      revision: { plan: { goal: internalPlan.goal, estimatedCostUsd: internalPlan.estimatedCostUsd } },
    });
    expect(workspace?.operations.find((item) => item.type === "build_composition")).toMatchObject({
      state: "succeeded",
      artifact: { digest: "1".repeat(64), mime: "application/zip", sizeBytes: 100 },
    });
    expect(JSON.stringify(workspace)).not.toContain("claimTokenDigest");

    const rerendered = await runWithTenant(operatorScope, () => requestProductionRerender(
      internalPlan.id, { requestId: "rerender-internal-1" },
    ));
    expect(rerendered).toMatchObject({ internalRun: 1, state: "scheduled" });
    expect(await runWithTenant(operatorScope, () => requestProductionRerender(
      internalPlan.id, { requestId: "rerender-internal-1" },
    ))).toEqual(rerendered);
    expect(await runWithTenant(operatorScope, () => getProductionPlan(internalPlan.id)))
      .toMatchObject({ internalRun: 1 });
    await expect(runWithTenant(serviceScope, () => completeInternalProductionOperation(
      internalPlan.id, assemble.id, {
        claimId: assembleClaim.claim.id,
        claimToken: "internal-export-worker",
        artifact: {
          objectKey: `durable-artifacts/${workspaceId}/${brandId}/production/plan-internal/stale-export.zip`,
          mime: "application/zip", digest: "f".repeat(64), sizeBytes: 100,
        },
        operationMetadata: { kind: "stale_export" },
      },
    ))).rejects.toThrow(/superseded by a newer plan revision or render run/i);
    expect(await runWithTenant(serviceScope, () => listDispatchableProductionOutbox(
      100, new Date("2098-01-02T00:00:00.000Z"),
    ))).toEqual(expect.arrayContaining([
      expect.objectContaining({ planId: internalPlan.id, operationId: build.id, internalRun: 1, state: "pending" }),
    ]));
    await expect(runWithTenant(serviceScope, () => claimProductionOperation(
      internalPlan.id, build.id, wake(internalPlan, "stale-build-wake", 0),
    ))).rejects.toThrow(/superseded internal run/i);
    const rerenderBuild = await runWithTenant(serviceScope, () => claimProductionOperation(
      internalPlan.id, build.id, wake(internalPlan, "internal-build-rerender-worker", 1),
    ));
    expect(rerenderBuild).toMatchObject({
      outcome: "execute", claim: { kind: "internal", internalRun: 1 },
      inputs: [{ operationId: paid.id, artifact: { digest: "e".repeat(64) } }],
    });
    expect(rerenderBuild.claim.id).not.toBe(buildClaim.claim.id);
    expect(await runWithTenant(serviceScope, () => claimProductionOperation(
      internalPlan.id, paid.id, wake(internalPlan, "paid-must-not-rerun"),
    ))).toMatchObject({ outcome: "already_succeeded", claim: { id: paidClaim.claim.id } });
  });

  it("rejects a claimed operation if its revision is superseded before provider submission", async () => {
    const raceJobId = `production-race-${Date.now()}`;
    const racePlan = videoProductionPlanSchema.parse({
      ...basePlan,
      id: "plan-race",
      jobId: raceJobId,
      operationCostsUsd: {
        "plan-race:generate_video:scene-1": "0.320000",
        "plan-race:generate_music": "0.120000",
      },
    });
    await db().doc(`workspaces/${workspaceId}`).set({ defaultBrandId: brandId });
    await db().doc(`workspaces/${workspaceId}/jobs/${raceJobId}`).set({
      workspaceId, brandId, status: "running", stage: "draft",
      createdAt: "2026-08-31T09:00:00.000Z", updatedAt: "2026-08-31T09:00:00.000Z",
    });
    await runWithTenant(serviceScope, () => proposeProductionPlan(racePlan));
    await runWithTenant(operatorScope, () => sealProductionPlan(racePlan.id, {
      planDigest: productionPlanDigest(racePlan),
    }));
    await runWithTenant(operatorScope, () => approveProductionPlan(racePlan.id, {
      planDigest: productionPlanDigest(racePlan),
      expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    const operation = compileProductionOperations(racePlan).find((item) => item.type === "generate_video")!;
    const initialWake = (await runWithTenant(serviceScope, () => listDispatchableProductionOutbox(
      20, new Date("2098-01-01T00:00:00.000Z"),
    ))).find((record) => record.planId === racePlan.id && record.operationId === operation.id)!;
    const publishingWake = await runWithTenant(serviceScope, () => claimProductionOutbox(
      initialWake.id, "b".repeat(64),
    ));
    expect(publishingWake.outcome).toBe("publish");
    const publishedWake = await runWithTenant(serviceScope, () => finalizeProductionOutboxPublish(
      initialWake.id, "b".repeat(64), "production-message-race",
    ));
    expect(publishedWake).toMatchObject({ state: "published", pubsubMessageId: "production-message-race" });
    expect(Date.parse(publishedWake.availableAt)).toBeGreaterThan(Date.parse(publishedWake.updatedAt));
    expect(await runWithTenant(serviceScope, () => listDispatchableProductionOutbox(
      100, new Date(Date.parse(publishedWake.availableAt) + 1),
    ))).toEqual(expect.arrayContaining([expect.objectContaining({ id: initialWake.id, state: "published" })]));
    await db().doc(
      `workspaces/${workspaceId}/brands/${brandId}/production_operation_outbox/${initialWake.id}`,
    ).update({ availableAt: "2000-01-01T00:00:00.000Z" });
    expect(await runWithTenant(serviceScope, () => claimProductionOutbox(
      initialWake.id, "c".repeat(64),
    ))).toMatchObject({ outcome: "publish", record: { state: "publishing", publishAttempt: 2 } });
    await db().doc(
      `workspaces/${workspaceId}/brands/${brandId}/production_operation_outbox/${initialWake.id}`,
    ).update({ publishLeaseExpiresAt: "2000-01-01T00:00:00.000Z" });
    expect(await runWithTenant(serviceScope, () => listDispatchableProductionOutbox(
      100, new Date(),
    ))).toEqual(expect.arrayContaining([expect.objectContaining({ id: initialWake.id, state: "publishing" })]));
    expect(await runWithTenant(serviceScope, () => claimProductionOutbox(
      initialWake.id, "d".repeat(64),
    ))).toMatchObject({ outcome: "publish", record: { state: "publishing", publishAttempt: 3 } });
    const claimed = await runWithTenant(serviceScope, () => claimPaidProductionOperation(
      racePlan.id, operation.id, wake(racePlan, "race-worker"),
    ));
    const revisionTwo = videoProductionPlanSchema.parse({
      ...racePlan,
      revision: 2,
      scenes: [{ ...racePlan.scenes[0], video: { ...racePlan.scenes[0].video!, prompt: "Superseding prompt" } }],
    });
    await runWithTenant(serviceScope, () => proposeProductionPlan(revisionTwo));

    await expect(runWithTenant(serviceScope, () => startProductionProviderSubmission(
      racePlan.id,
      operation.id,
      {
        claimId: claimed.claim.id,
        claimToken: "race-worker",
        provider: "veo",
      },
    ))).rejects.toThrow(/no longer authorizes|active production mandate|current revision/i);
  });

  it("persists immutable revisions and invalidates the active mandate after a material revision", async () => {
    await db().doc(`workspaces/${workspaceId}`).set({ defaultBrandId: brandId });
    await db().doc(`workspaces/${workspaceId}/jobs/${jobId}`).set({
      workspaceId, brandId, status: "running", stage: "draft",
      createdAt: "2026-08-31T09:00:00.000Z", updatedAt: "2026-08-31T09:00:00.000Z",
    });

    await runWithTenant(serviceScope, () => proposeProductionPlan(basePlan, "2026-08-31T10:00:00.000Z"));
    const proposed = await runWithTenant(operatorScope, () => getProductionPlan(basePlan.id));
    expect(proposed).toMatchObject({
      id: basePlan.id,
      state: "proposed",
      currentRevision: 1,
      currentPlanDigest: productionPlanDigest(basePlan),
      activeMandateId: null,
    });

    await runWithTenant(operatorScope, () => sealProductionPlan(basePlan.id, {
      planDigest: productionPlanDigest(basePlan),
      sealedAt: "2026-08-31T10:05:00.000Z",
    }));
    const mandate = await runWithTenant(operatorScope, () => approveProductionPlan(basePlan.id, {
      planDigest: productionPlanDigest(basePlan),
      approvedAt: "2026-08-31T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    if (!mandate) throw new Error("paid production plan requires a mandate");
    const initialOutbox = await db().collection(
      `workspaces/${workspaceId}/brands/${brandId}/production_operation_outbox`,
    ).get();
    expect(initialOutbox.docs.map((doc) => doc.data())).toEqual(expect.arrayContaining([
      expect.objectContaining({ planId: basePlan.id, operationId: "plan-1:generate_video:scene-1", state: "pending" }),
      expect.objectContaining({ planId: basePlan.id, operationId: "plan-1:generate_music", state: "pending" }),
    ]));
    const paidOperation = compileProductionOperations(basePlan).find((operation) => operation.type === "generate_video")!;
    const claims = await runWithTenant(serviceScope, () => Promise.all([
      claimPaidProductionOperation(basePlan.id, paidOperation.id, {
        ...wake(basePlan, "worker-a"),
      }),
      claimPaidProductionOperation(basePlan.id, paidOperation.id, {
        ...wake(basePlan, "worker-b"),
      }),
    ]));
    expect(claims.map((claim) => claim.outcome).sort()).toEqual(["execute", "in_progress"]);
    const activeClaimIndex = claims.findIndex((claim) => claim.outcome === "execute");
    const activeClaim = claims[activeClaimIndex];
    const activeClaimToken = activeClaimIndex === 0 ? "worker-a" : "worker-b";
    expect(activeClaim.claim).toMatchObject({
      planRevision: 1,
      planDigest: productionPlanDigest(basePlan),
      operationId: paidOperation.id,
      requestDigest: paidOperation.requestDigest,
      mandateId: mandate.id,
      state: "claimed",
      reservedCostUsd: "0.320000",
    });
    expect(activeClaim.operation).toEqual(paidOperation);

    await expect(runWithTenant(serviceScope, () => completePaidProductionOperation(
      basePlan.id,
      paidOperation.id,
      {
        claimId: activeClaim.claim.id,
        claimToken: activeClaimToken,
        artifact: {
          objectKey: `durable-artifacts/${workspaceId}/${brandId}/production/plan-1/untrusted.mp4`,
          mime: "video/mp4",
          digest: "d".repeat(64),
          sizeBytes: 5,
        },
        providerMetadata: {},
      },
    ))).rejects.toThrow(/cannot complete|provider identity/i);

    await runWithTenant(serviceScope, () => startProductionProviderSubmission(
      basePlan.id,
      paidOperation.id,
      {
        claimId: activeClaim.claim.id,
        claimToken: activeClaimToken,
        provider: "veo",
      },
    ));

    await runWithTenant(serviceScope, () => recordProductionProviderOperation(
      basePlan.id,
      paidOperation.id,
      {
        claimId: activeClaim.claim.id,
        claimToken: activeClaimToken,
        provider: "veo",
        providerOperationId: "projects/p/locations/us-central1/operations/veo-1",
        nextPollAt: "2000-01-01T00:00:00.000Z",
      },
    ));
    const videoOutboxAfterPoll = await db().doc(
      `workspaces/${workspaceId}/brands/${brandId}/production_operation_outbox/${activeClaim.claim.id}`,
    ).get();
    expect(videoOutboxAfterPoll.data()).toMatchObject({ state: "pending", availableAt: "2000-01-01T00:00:00.000Z" });
    const resumed = await runWithTenant(serviceScope, () => claimPaidProductionOperation(
      basePlan.id,
      paidOperation.id,
      wake(basePlan, "worker-resume"),
    ));
    expect(resumed).toMatchObject({
      outcome: "execute",
      claim: {
        provider: "veo",
        providerOperationId: "projects/p/locations/us-central1/operations/veo-1",
      },
      operation: { id: paidOperation.id },
    });
    await expect(runWithTenant(serviceScope, () => recordProductionProviderOperation(
      basePlan.id,
      paidOperation.id,
      {
        claimId: activeClaim.claim.id,
        claimToken: "worker-resume",
        provider: "veo",
        providerOperationId: "projects/p/locations/us-central1/operations/veo-1",
        nextPollAt: "2000-01-01T00:00:01.000Z",
      },
    ))).resolves.toMatchObject({
      state: "waiting_provider",
      providerOperationId: "projects/p/locations/us-central1/operations/veo-1",
    });
    await runWithTenant(serviceScope, () => completePaidProductionOperation(
      basePlan.id,
      paidOperation.id,
      {
        claimId: resumed.claim.id,
        claimToken: "worker-resume",
        artifact: {
          objectKey: `durable-artifacts/${workspaceId}/${brandId}/production/plan-1/video.mp4`,
          mime: "video/mp4",
          digest: "c".repeat(64),
          sizeBytes: 5,
        },
        providerMetadata: {
          provider: "veo",
          providerOperationId: "projects/p/locations/us-central1/operations/veo-1",
          model: "veo-3.1-fast-generate-001",
        },
      },
    ));
    const duplicate = await runWithTenant(serviceScope, () => claimPaidProductionOperation(
      basePlan.id,
      paidOperation.id,
      wake(basePlan, "worker-duplicate"),
    ));
    expect(duplicate).toMatchObject({
      outcome: "already_succeeded",
      claim: { state: "succeeded", artifact: { digest: "c".repeat(64) } },
    });
    expect((await db().doc(
      `workspaces/${workspaceId}/brands/${brandId}/production_operation_outbox/${activeClaim.claim.id}`,
    ).get()).data()).toMatchObject({ state: "completed" });
    expect(await runWithTenant(operatorScope, () => getProductionPlan(basePlan.id))).toMatchObject({
      currentMandateReservedCostUsd: "0.320000",
    });
    const musicOperation = compileProductionOperations(basePlan).find((operation) => operation.type === "generate_music")!;
    const musicClaim = await runWithTenant(serviceScope, () => claimPaidProductionOperation(
      basePlan.id,
      musicOperation.id,
      wake(basePlan, "worker-music"),
    ));
    expect(musicClaim).toMatchObject({ outcome: "execute", claim: { reservedCostUsd: "0.120000" } });
    await runWithTenant(serviceScope, () => startProductionProviderSubmission(
      basePlan.id,
      musicOperation.id,
      {
        claimId: musicClaim.claim.id,
        claimToken: "worker-music",
        provider: "lyria",
      },
    ));
    await runWithTenant(serviceScope, () => recordProductionProviderOperation(
      basePlan.id,
      musicOperation.id,
      {
        claimId: musicClaim.claim.id,
        claimToken: "worker-music",
        provider: "lyria",
        providerOperationId: "interactions/lyria-1",
        nextPollAt: "2000-01-01T00:00:00.000Z",
      },
    ));
    const quarantinedMusic = await runWithTenant(serviceScope, () => claimPaidProductionOperation(
      basePlan.id,
      musicOperation.id,
      wake(basePlan, "worker-music-retry"),
    ));
    expect(quarantinedMusic).toMatchObject({ outcome: "uncertain", claim: { state: "uncertain" } });
    const expiredMandate = createProductionMandate(basePlan, {
      operatorSubjectId: "operator-test",
      authenticationId: "firebase-production-test",
      approvedAt: "1999-01-01T00:00:00.000Z",
      expiresAt: "2000-01-01T00:00:00.000Z",
    });
    await db().doc(
      `workspaces/${workspaceId}/brands/${brandId}/production_plans/${basePlan.id}/mandates/${mandate.id}`,
    ).set(expiredMandate);
    const completedAfterExpiry = await runWithTenant(serviceScope, () => claimPaidProductionOperation(
      basePlan.id,
      paidOperation.id,
      wake(basePlan, "worker-after-expiry"),
    ));
    expect(completedAfterExpiry).toMatchObject({ outcome: "already_succeeded" });
    expect(await runWithTenant(operatorScope, () => getProductionPlan(basePlan.id))).toMatchObject({
      currentMandateReservedCostUsd: "0.440000",
    });

    const revisedVideo = { ...basePlan.scenes[0].video!, prompt: "Amber network with measured motion" };
    const revisionTwo = videoProductionPlanSchema.parse({
      ...basePlan,
      revision: 2,
      scenes: [{ ...basePlan.scenes[0], video: revisedVideo }],
      operationCostsUsd: {
        "plan-1:generate_video:scene-1": "0.320000",
        "plan-1:generate_music": "0.120000",
      },
    });
    await runWithTenant(serviceScope, () => proposeProductionPlan(revisionTwo, "2026-08-31T10:40:00.000Z"));

    const [current, original] = await runWithTenant(operatorScope, () => Promise.all([
      getProductionPlan(basePlan.id),
      getProductionPlanRevision(basePlan.id, 1),
    ]));
    expect(current).toMatchObject({ state: "proposed", currentRevision: 2, activeMandateId: null });
    expect(original?.plan).toEqual(basePlan);
    await expect(runWithTenant(serviceScope, () => claimPaidProductionOperation(
      basePlan.id,
      paidOperation.id,
      {
        ...wake(revisionTwo, "worker-c"),
      },
    ))).rejects.toThrow(/active production mandate/i);

    await runWithTenant(serviceScope, () => sealProductionPlan(revisionTwo.id, {
      planDigest: productionPlanDigest(revisionTwo),
    }));
    const revisionTwoMandate = await runWithTenant(operatorScope, () => approveProductionPlan(revisionTwo.id, {
      planDigest: productionPlanDigest(revisionTwo),
      expiresAt: "2099-01-01T00:00:00.000Z",
    }));
    if (!revisionTwoMandate) throw new Error("paid production revision requires a mandate");
    const revisionTwoOperation = compileProductionOperations(revisionTwo).find((operation) => operation.type === "generate_video")!;
    const revisionTwoClaim = await runWithTenant(serviceScope, () => claimPaidProductionOperation(
      revisionTwo.id,
      revisionTwoOperation.id,
      wake(revisionTwo, "worker-v2"),
    ));
    expect(revisionTwoClaim).toMatchObject({
      outcome: "execute",
      claim: { planRevision: 2, mandateId: revisionTwoMandate.id, requestDigest: revisionTwoOperation.requestDigest },
    });
    await runWithTenant(serviceScope, () => startProductionProviderSubmission(
      revisionTwo.id,
      revisionTwoOperation.id,
      {
        claimId: revisionTwoClaim.claim.id,
        claimToken: "worker-v2",
        provider: "veo",
      },
    ));
    await db().doc(
      `workspaces/${workspaceId}/brands/${brandId}/production_plans/${revisionTwo.id}/operation_claims/${revisionTwoClaim.claim.id}`,
    ).update({ leaseExpiresAt: "2000-01-01T00:00:00.000Z" });
    const ambiguousSubmission = await runWithTenant(serviceScope, () => claimPaidProductionOperation(
      revisionTwo.id,
      revisionTwoOperation.id,
      wake(revisionTwo, "worker-v2-redelivery"),
    ));
    expect(ambiguousSubmission).toMatchObject({ outcome: "uncertain", claim: { state: "uncertain" } });
  });

  it("persists an immutable rejection decision with verified operator provenance", async () => {
    const rejectedJobId = `${jobId}-reject`;
    await db().doc(`workspaces/${workspaceId}/jobs/${rejectedJobId}`).set({
      id: rejectedJobId, workspaceId, brandId, status: "active", stage: "publish",
    });
    const rejectedPlan = videoProductionPlanSchema.parse({
      ...basePlan,
      id: "plan-reject",
      jobId: rejectedJobId,
      operationCostsUsd: {
        "plan-reject:generate_video:scene-1": "0.320000",
        "plan-reject:generate_music": "0.120000",
      },
    });
    const digest = productionPlanDigest(rejectedPlan);
    await runWithTenant(serviceScope, () => proposeProductionPlan(rejectedPlan, "2026-08-31T10:00:00.000Z"));
    await runWithTenant(serviceScope, () => sealProductionPlan(rejectedPlan.id, {
      planDigest: digest,
      sealedAt: "2026-08-31T10:05:00.000Z",
    }));
    const rejected = await runWithTenant(operatorScope, () => rejectProductionPlan(rejectedPlan.id, {
      planDigest: digest,
      feedback: "Use the source footage instead",
      rejectedAt: "2026-08-31T10:06:00.000Z",
    }));
    expect(rejected).toMatchObject({ state: "rejected", activeMandateId: null });
    const decision = await db().doc(
      `workspaces/${workspaceId}/brands/${brandId}/production_plans/${rejectedPlan.id}/decisions/v1`,
    ).get();
    expect(decision.data()).toMatchObject({
      decision: "rejected",
      planDigest: digest,
      actorSubjectId: "operator-test",
      authenticationId: "firebase-production-test",
      feedback: "Use the source footage instead",
    });
  });

  afterAll(async () => {
    if (emulator) await db().recursiveDelete(db().doc(`workspaces/${workspaceId}`));
  });
});
