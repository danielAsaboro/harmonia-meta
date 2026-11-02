import { describe, expect, it } from "vitest";
import {
  assertProductionMandateAuthorizes,
  compileProductionOperations,
  createProductionMandate,
  estimateGeneratedMediaCost,
  generatedMusicSpecSchema,
  generatedVideoSpecSchema,
  mediaOperationSchema,
  productionApprovalStillValid,
  productionPlanDigest,
  transitionMediaOperation,
  videoProductionPlanSchema,
} from "@/lib/mediaProduction";

const videoSpec = generatedVideoSpecSchema.parse({
  modelCapability: "veo-3.1-fast", mode: "text_to_video", prompt: "Abstract data streams forming a calm blue network", durationSec: 4,
  aspectRatio: "9:16", resolution: "1080p", generateAudio: false, enhancePrompt: true, outputCount: 1,
});
const musicSpec = generatedMusicSpecSchema.parse({
  modelCapability: "lyria-3-clip", prompt: "Warm minimal electronic soundtrack, 100 BPM", instrumental: true,
  lyricsMode: "none", language: "en", targetDurationSec: 30, outputCount: 1,
});
const sourceRef = {
  artifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d11",
  digest: "1".repeat(64),
  mime: "video/mp4",
  sizeBytes: 1234,
  rightsAuthorizationId: "license-source-1",
} as const;
const narrationRef = {
  artifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d12",
  digest: "2".repeat(64),
  mime: "audio/wav",
  sizeBytes: 4321,
  rightsAuthorizationId: "license-narration-1",
} as const;
const firstFrameRef = {
  artifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d13",
  digest: "3".repeat(64),
  mime: "image/png",
  sizeBytes: 2048,
  rightsAuthorizationId: "license-frame-first-1",
} as const;
const lastFrameRef = {
  artifactId: "018f47a2-4f40-7b1f-b19f-8f6b916b7d14",
  digest: "4".repeat(64),
  mime: "image/jpeg",
  sizeBytes: 4096,
  rightsAuthorizationId: "license-frame-last-1",
} as const;
const sourceEdit = {
  sourceWindow: { startSec: 120.5, durationSec: 12 },
  sourceSegmentRefs: ["segment-wozniak-1"],
  preserveSourceAudio: true,
  reframe: { xPercent: 50, yPercent: 42, scale: 1.35 },
  captions: [{
    id: "caption-1", startSec: 0.25, durationSec: 3.5,
    text: "The most important thing is to build.",
    sourceSegmentRefs: ["segment-wozniak-1"],
  }],
} as const;
const basePlan = {
  id: "plan-1",
  jobId: "job-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
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
} as const;

describe("media production contracts", () => {
  it("requires Lyria 3 Clip plans to quote its fixed 30-second provider output", () => {
    const soundtrack = {
      modelCapability: "lyria-3-clip" as const,
      prompt: "Minimal instrumental pulse", instrumental: true, lyricsMode: "none" as const,
      language: "en", targetDurationSec: 4, outputCount: 1 as const,
    };

    expect(generatedMusicSpecSchema.safeParse(soundtrack).success).toBe(false);
    expect(generatedMusicSpecSchema.safeParse({ ...soundtrack, targetDurationSec: 30 }).success).toBe(true);
  });
  it("rejects a Veo capability combination the selected model cannot execute", () => {
    expect(() => generatedVideoSpecSchema.parse({
      modelCapability: "veo-3.1-fast", mode: "extend_video", prompt: "continue",
      durationSec: 4, aspectRatio: "9:16",
      resolution: "4k", generateAudio: false, enhancePrompt: true, outputCount: 1,
    })).toThrow(/resolution/i);
  });

  it("seals supported Veo image conditioning and blocks modes without a selected-model path", () => {
    expect(generatedVideoSpecSchema.parse({
      ...basePlan.scenes[0].video,
      mode: "first_last_frame",
      sourceImageArtifact: firstFrameRef,
      lastFrameArtifact: lastFrameRef,
    })).toMatchObject({ sourceImageArtifact: firstFrameRef, lastFrameArtifact: lastFrameRef });
    expect(() => generatedVideoSpecSchema.parse({
      ...basePlan.scenes[0].video,
      mode: "image_to_video",
    })).toThrow();
    expect(() => generatedVideoSpecSchema.parse({
      ...basePlan.scenes[0].video,
      mode: "image_to_video",
      sourceImageArtifact: { ...firstFrameRef, mime: "video/mp4" },
    })).toThrow(/image/i);
    expect(() => generatedVideoSpecSchema.parse({
      ...basePlan.scenes[0].video,
      mode: "image_to_video",
      sourceImageArtifact: { ...firstFrameRef, sizeBytes: 20 * 1024 * 1024 + 1 },
    })).toThrow(/20.*MB|size/i);
    expect(() => generatedVideoSpecSchema.parse({
      ...basePlan.scenes[0].video,
      mode: "reference_images",
    })).toThrow(/mode|unrecognized/i);
    expect(() => generatedVideoSpecSchema.parse({
      ...basePlan.scenes[0].video,
      mode: "extend_video",
    })).toThrow(/mode|unrecognized/i);
    expect(() => generatedMusicSpecSchema.parse({
      ...basePlan.soundtrack,
      conditioningImageArtifactId: "image-1",
    })).toThrow(/conditioning|control/i);
  });

  it("runs verified conditioning resolvers before the exact paid Veo operation", () => {
    const conditioned = videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [{
        ...basePlan.scenes[0],
        video: {
          ...basePlan.scenes[0].video,
          mode: "first_last_frame",
          sourceImageArtifact: firstFrameRef,
          lastFrameArtifact: lastFrameRef,
        },
      }],
    });

    const operations = compileProductionOperations(conditioned);
    const resolved = operations.filter((operation) => operation.type === "resolve_media");
    expect(resolved.map((operation) => operation.payload)).toEqual([firstFrameRef, lastFrameRef]);
    expect(operations.find((operation) => operation.id === "plan-1:generate_video:scene-1")?.dependsOn)
      .toEqual(resolved.map((operation) => operation.id));
    expect(operations.find((operation) => operation.type === "build_composition")?.dependsOn)
      .toEqual(["plan-1:generate_video:scene-1", "plan-1:generate_music"]);
  });

  it("rejects conflicting identities for one conditioning artifact", () => {
    expect(() => videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [
        {
          ...basePlan.scenes[0], id: "scene-a",
          video: { ...basePlan.scenes[0].video, mode: "image_to_video", sourceImageArtifact: firstFrameRef },
        },
        {
          ...basePlan.scenes[0], id: "scene-b", order: 2, startSec: 4,
          video: {
            ...basePlan.scenes[0].video,
            mode: "image_to_video",
            sourceImageArtifact: { ...firstFrameRef, digest: "5".repeat(64) },
          },
        },
      ],
      operationCostsUsd: {
        "plan-1:generate_video:scene-a": "0.320000",
        "plan-1:generate_video:scene-b": "0.320000",
        "plan-1:generate_music": "0.120000",
      },
      estimatedCostUsd: "0.760000",
      maximumCostUsd: "0.800000",
    })).toThrow(/conflicting sealed identities/i);
  });

  it("seals verified source and narration artifacts into the operation graph", () => {
    const sourceBacked = videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [{ ...basePlan.scenes[0], ...sourceEdit, sourceArtifact: sourceRef, video: undefined }],
      narration: [{ id: "voice-1", artifact: narrationRef, startSec: 0.25, durationSec: 3.5 }],
      operationCostsUsd: { "plan-1:generate_music": "0.120000" },
      estimatedCostUsd: "0.120000",
      maximumCostUsd: "0.200000",
    });
    const operations = compileProductionOperations(sourceBacked);
    const resolved = operations.filter((item) => item.type === "resolve_media");
    expect(resolved.map((item) => item.payload)).toEqual([sourceRef, narrationRef]);
    expect(resolved.every((item) => item.executionAuthority === "internal" && item.estimatedCostUsd === undefined)).toBe(true);
    expect(operations.find((item) => item.type === "build_composition")?.dependsOn).toEqual([
      ...resolved.map((item) => item.id),
      "plan-1:generate_music",
    ]);
  });

  it("seals evidence-bound source windows, original speech, captions, and deterministic reframing", () => {
    const parsed = videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [{ ...basePlan.scenes[0], ...sourceEdit, sourceArtifact: sourceRef, video: undefined }],
      soundtrack: undefined,
      operationCostsUsd: {},
      estimatedCostUsd: "0.000000",
      maximumCostUsd: "0.000000",
    });

    expect(parsed.scenes[0]).toMatchObject(sourceEdit);
    expect(compileProductionOperations(parsed).filter((operation) => operation.executionAuthority === "production_mandate"))
      .toEqual([]);
  });

  it("rejects ungrounded, out-of-window, or generated source-edit fields", () => {
    const sourcePlan = {
      ...basePlan,
      scenes: [{ ...basePlan.scenes[0], ...sourceEdit, sourceArtifact: sourceRef, video: undefined }],
      soundtrack: undefined,
      operationCostsUsd: {},
      estimatedCostUsd: "0.000000",
      maximumCostUsd: "0.000000",
    };
    expect(() => videoProductionPlanSchema.parse({
      ...sourcePlan,
      scenes: [{ ...sourcePlan.scenes[0], sourceSegmentRefs: [] }],
    })).toThrow(/source segment|lineage/i);
    expect(() => videoProductionPlanSchema.parse({
      ...sourcePlan,
      scenes: [{
        ...sourcePlan.scenes[0],
        captions: [{ ...sourceEdit.captions[0], startSec: 11, durationSec: 2 }],
      }],
    })).toThrow(/caption.*scene|window/i);
    expect(() => videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [{ ...basePlan.scenes[0], ...sourceEdit }],
    })).toThrow(/source-only|source artifact/i);
  });

  it("rejects unsealed or ambiguous production media sources", () => {
    expect(() => videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [{ ...basePlan.scenes[0], sourceArtifact: sourceRef }],
    })).toThrow(/exactly one/i);
    expect(() => videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [{ ...basePlan.scenes[0], video: undefined }],
    })).toThrow(/exactly one/i);
    expect(() => videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [{ ...basePlan.scenes[0], ...sourceEdit, sourceArtifact: { ...sourceRef, digest: "not-a-digest" }, video: undefined }],
      operationCostsUsd: { "plan-1:generate_music": "0.120000" },
      estimatedCostUsd: "0.120000",
    })).toThrow(/digest/i);
    const { rightsAuthorizationId: _rights, ...unlicensed } = sourceRef;
    expect(() => videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [{ ...basePlan.scenes[0], ...sourceEdit, sourceArtifact: unlicensed, video: undefined }],
      operationCostsUsd: { "plan-1:generate_music": "0.120000" },
      estimatedCostUsd: "0.120000",
    })).toThrow(/authorization/i);
    expect(() => videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [{ ...basePlan.scenes[0], ...sourceEdit, sourceArtifact: { ...sourceRef, mime: "video/webm" }, video: undefined }],
      operationCostsUsd: { "plan-1:generate_music": "0.120000" },
      estimatedCostUsd: "0.120000",
    })).toThrow(/mime|mp4/i);
    expect(() => videoProductionPlanSchema.parse({
      ...basePlan,
      scenes: [{ ...basePlan.scenes[0], ...sourceEdit, sourceArtifact: { ...sourceRef, sizeBytes: 64 * 1024 * 1024 + 1 }, video: undefined }],
      operationCostsUsd: { "plan-1:generate_music": "0.120000" },
      estimatedCostUsd: "0.120000",
    })).toThrow(/size|too big|less than/i);
    expect(() => videoProductionPlanSchema.parse({
      ...basePlan,
      narration: [{ id: "voice-late", artifact: narrationRef, startSec: 29, durationSec: 2 }],
    })).toThrow(/narration.*target|timeline/i);
  });

  it("rejects Lyria lyrics when instrumental mode is selected", () => {
    expect(() => generatedMusicSpecSchema.parse({
      modelCapability: "lyria-3-clip", prompt: "bright pop",
      instrumental: true, lyricsMode: "provided", providedLyrics: "hello",
      language: "en", targetDurationSec: 30, outputCount: 1,
    })).toThrow(/lyrics/i);
  });

  it("produces a stable digest and invalidates approval after a material revision", () => {
    const parsed = videoProductionPlanSchema.parse(basePlan);
    const digest = productionPlanDigest(parsed);
    const reordered = Object.fromEntries(Object.entries(basePlan).reverse());
    expect(productionPlanDigest(videoProductionPlanSchema.parse(reordered))).toBe(digest);
    expect(productionApprovalStillValid({ planDigest: digest, planRevision: 1, expiresAt: "2099-01-01T00:00:00.000Z" }, parsed, new Date("2026-08-31T00:00:00.000Z"))).toBe(true);
    expect(productionApprovalStillValid({ planDigest: digest, planRevision: 1, expiresAt: "2099-01-01T00:00:00.000Z" }, { ...parsed, revision: 2 }, new Date("2026-08-31T00:00:00.000Z"))).toBe(false);
  });

  it("seals exact paid calls, scope, operator identity, and maximum cost", () => {
    const parsed = videoProductionPlanSchema.parse(basePlan);
    const mandate = createProductionMandate(parsed, {
      operatorSubjectId: "operator-1",
      authenticationId: "session-1",
      approvedAt: "2026-08-31T10:00:00.000Z",
      expiresAt: "2026-08-31T11:00:00.000Z",
    });
    expect(mandate).toMatchObject({
      jobId: parsed.jobId,
      workspaceId: parsed.workspaceId,
      brandId: parsed.brandId,
      maximumCostUsd: parsed.maximumCostUsd,
      operatorSubjectId: "operator-1",
    });
    expect(mandate.paidOperationDigests).toEqual(
      compileProductionOperations(parsed)
        .filter((operation) => operation.executionAuthority === "production_mandate")
        .map((operation) => operation.requestDigest),
    );
    expect(productionApprovalStillValid(mandate, parsed, new Date("2026-08-31T10:30:00.000Z"))).toBe(true);
    expect(productionApprovalStillValid({ ...mandate, paidOperationDigests: [] }, parsed, new Date("2026-08-31T10:30:00.000Z"))).toBe(false);
  });

  it("authorizes only an exact paid operation while the current mandate is active", () => {
    const plan = videoProductionPlanSchema.parse(basePlan);
    const operation = compileProductionOperations(plan).find((candidate) => candidate.type === "generate_video")!;
    const mandate = createProductionMandate(plan, {
      operatorSubjectId: "operator-1",
      authenticationId: "session-1",
      approvedAt: "2026-08-31T10:00:00.000Z",
      expiresAt: "2026-08-31T11:00:00.000Z",
    });

    expect(assertProductionMandateAuthorizes({
      mandate,
      plan,
      operation,
      activeMandateId: mandate.id,
      workspaceId: plan.workspaceId,
      brandId: plan.brandId,
      now: new Date("2026-08-31T10:30:00.000Z"),
    })).toBe(operation);

    expect(() => assertProductionMandateAuthorizes({
      mandate,
      plan: { ...plan, revision: 2 },
      operation,
      activeMandateId: mandate.id,
      workspaceId: plan.workspaceId,
      brandId: plan.brandId,
      now: new Date("2026-08-31T10:30:00.000Z"),
    })).toThrow(/current plan/i);
    expect(() => assertProductionMandateAuthorizes({
      mandate,
      plan,
      operation: compileProductionOperations(plan).find((candidate) => candidate.type === "build_composition")!,
      activeMandateId: mandate.id,
      workspaceId: plan.workspaceId,
      brandId: plan.brandId,
      now: new Date("2026-08-31T10:30:00.000Z"),
    })).toThrow(/paid operation/i);
    expect(() => assertProductionMandateAuthorizes({
      mandate,
      plan,
      operation,
      activeMandateId: null,
      workspaceId: plan.workspaceId,
      brandId: plan.brandId,
      now: new Date("2026-08-31T10:30:00.000Z"),
    })).toThrow(/inactive/i);
    expect(() => assertProductionMandateAuthorizes({
      mandate,
      plan,
      operation,
      activeMandateId: mandate.id,
      workspaceId: plan.workspaceId,
      brandId: plan.brandId,
      now: new Date("2026-08-31T11:00:00.000Z"),
    })).toThrow(/expired/i);
    expect(() => assertProductionMandateAuthorizes({
      mandate,
      plan,
      operation,
      activeMandateId: mandate.id,
      workspaceId: plan.workspaceId,
      brandId: plan.brandId,
      now: new Date("2026-08-31T09:59:59.000Z"),
    })).toThrow(/not active/i);
  });

  it("prices Veo from duration and rejects unpriced preview Lyria without an override", () => {
    const plan = videoProductionPlanSchema.parse(basePlan);
    expect(estimateGeneratedMediaCost(plan.scenes[0].video!)).toBe("0.320000");
    expect(() => estimateGeneratedMediaCost(plan.soundtrack!)).toThrow(/pricing unavailable/i);
    expect(estimateGeneratedMediaCost(plan.soundtrack!, { "lyria-3-clip": "0.120000" })).toBe("0.120000");
  });

  it("rejects a plan whose signed operation quotes do not exactly fund its paid graph", () => {
    expect(() => videoProductionPlanSchema.parse({
      ...basePlan,
      operationCostsUsd: { "plan-1:generate_video:scene-1": "0.000001" },
    })).toThrow(/operation cost quotes/i);
  });

  it("itemizes repeated identical paid requests as distinct operation costs", () => {
    const repeated = {
      ...basePlan,
      scenes: [
        basePlan.scenes[0],
        { ...basePlan.scenes[0], id: "scene-2", order: 2, startSec: 4 },
      ],
      operationCostsUsd: {
        "plan-1:generate_video:scene-1": "0.320000",
        "plan-1:generate_video:scene-2": "0.320000",
        "plan-1:generate_music": "0.120000",
      },
      estimatedCostUsd: "0.760000",
      maximumCostUsd: "0.800000",
    };
    const operations = compileProductionOperations(videoProductionPlanSchema.parse(repeated));
    expect(operations.filter((operation) => operation.type === "generate_video").map((operation) => operation.estimatedCostUsd))
      .toEqual(["0.320000", "0.320000"]);
  });

  it("compiles paid media before composition and finalization", () => {
    const operations = compileProductionOperations(videoProductionPlanSchema.parse(basePlan));
    expect(operations.map((operation) => operation.type)).toEqual([
      "generate_video", "generate_music", "build_composition", "render_composition",
      "mix_audio", "ffmpeg_finalize", "inspect_media", "evaluate_production", "repair_media",
      "inspect_delivery", "evaluate_delivery", "assemble_export",
    ]);
    expect(operations[2].dependsOn).toEqual([operations[0].id, operations[1].id]);
    expect(operations.at(-1)?.dependsOn).toEqual([
      "plan-1:repair_media", "plan-1:evaluate_delivery",
    ]);
    expect(operations.slice(0, 2).map((operation) => operation.estimatedCostUsd)).toEqual(["0.320000", "0.120000"]);
  });

  it("models provider pending as a durable nonterminal state", () => {
    const operation = mediaOperationSchema.parse({
      id: "media-1", jobId: "job-1", actionId: "action-1", provider: "veo",
      state: "provider_pending", providerOperationId: "operations/123", attempt: 1,
      requestDigest: "a".repeat(64), estimatedCostUsd: "0.320000",
      createdAt: "2026-08-31T00:00:00.000Z", updatedAt: "2026-08-31T00:00:10.000Z",
    });
    expect(operation.state).toBe("provider_pending");
    expect(transitionMediaOperation(operation, "provider_succeeded", "2026-08-31T00:01:00.000Z").state).toBe("provider_succeeded");
    expect(() => transitionMediaOperation(operation, "prepared", "2026-08-31T00:01:00.000Z")).toThrow(/transition/i);
  });
});
