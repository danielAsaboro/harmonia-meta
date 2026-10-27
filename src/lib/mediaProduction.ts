import { createHash } from "node:crypto";
import { z } from "zod";

const usd = z.string().regex(/^\d+\.\d{6}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const artifactId = z.string().uuid();

export const verifiedProductionArtifactRefSchema = z.object({
  artifactId,
  digest,
  mime: z.enum(["video/mp4", "audio/mpeg", "audio/wav", "image/jpeg", "image/png"]),
  sizeBytes: z.number().int().positive().max(64 * 1024 * 1024),
  rightsAuthorizationId: z.string().regex(/^[A-Za-z0-9:_-]{1,256}$/),
}).strict();
export type VerifiedProductionArtifactRef = z.infer<typeof verifiedProductionArtifactRefSchema>;

export const VEO_CAPABILITIES = {
  "veo-3.1-fast": { model: "veo-3.1-fast-generate-001", resolutions: ["720p", "1080p"], durations: [4, 6, 8], modes: ["text_to_video", "image_to_video", "first_last_frame"], usdPerSecond: "0.080000", preview: false },
  "veo-3.1": { model: "veo-3.1-generate-001", resolutions: ["720p", "1080p", "4k"], durations: [4, 6, 8], modes: ["text_to_video", "image_to_video", "first_last_frame"], usdPerSecond: null, preview: false },
} as const;

export const LYRIA_CAPABILITIES = {
  "lyria-3-clip": { model: "lyria-3-clip-preview", durations: [30], imageConditioning: true, vocals: true, structure: true, preview: true, fixedCostUsd: null },
  "lyria-3-pro": { model: "lyria-3-pro-preview", durations: [184], imageConditioning: true, vocals: true, structure: true, preview: true, fixedCostUsd: null },
  "lyria-2": { model: "lyria-002", durations: [30], imageConditioning: false, vocals: false, structure: false, preview: false, fixedCostUsd: "0.060000" },
} as const;

const videoCapability = z.enum(["veo-3.1-fast", "veo-3.1"]);
const videoMode = z.enum(["text_to_video", "image_to_video", "first_last_frame", "reference_images", "extend_video"]);
export const generatedVideoSpecSchema = z.object({
  modelCapability: videoCapability,
  mode: videoMode,
  prompt: z.string().min(1).max(4000),
  negativePrompt: z.string().min(1).max(2000).optional(),
  sourceImageArtifact: verifiedProductionArtifactRefSchema.optional(),
  lastFrameArtifact: verifiedProductionArtifactRefSchema.optional(),
  durationSec: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  aspectRatio: z.enum(["16:9", "9:16"]),
  resolution: z.enum(["720p", "1080p", "4k"]),
  generateAudio: z.boolean(),
  seed: z.number().int().nonnegative().max(4294967295).optional(),
  enhancePrompt: z.boolean(),
  outputCount: z.literal(1),
}).strict().superRefine((value, context) => {
  const capability = VEO_CAPABILITIES[value.modelCapability];
  if (!(capability.resolutions as readonly string[]).includes(value.resolution)) context.addIssue({ code: "custom", path: ["resolution"], message: `resolution is not supported by ${value.modelCapability}` });
  if (!(capability.durations as readonly number[]).includes(value.durationSec)) context.addIssue({ code: "custom", path: ["durationSec"], message: `duration is not supported by ${value.modelCapability}` });
  if (!(capability.modes as readonly string[]).includes(value.mode)) context.addIssue({ code: "custom", path: ["mode"], message: `mode is not supported by ${value.modelCapability}` });
  const requireField = (condition: boolean, field: keyof typeof value, message: string) => { if (condition && !value[field]) context.addIssue({ code: "custom", path: [field], message }); };
  requireField(value.mode === "image_to_video" || value.mode === "first_last_frame", "sourceImageArtifact", "source image is required");
  requireField(value.mode === "first_last_frame", "lastFrameArtifact", "last frame is required");
  if (value.mode === "text_to_video" && (value.sourceImageArtifact || value.lastFrameArtifact)) {
    context.addIssue({ code: "custom", path: ["sourceImageArtifact"], message: "text-to-video cannot include conditioning images" });
  }
  if (value.mode !== "first_last_frame" && value.lastFrameArtifact) {
    context.addIssue({ code: "custom", path: ["lastFrameArtifact"], message: "last frame requires first-last-frame mode" });
  }
  for (const field of ["sourceImageArtifact", "lastFrameArtifact"] as const) {
    const reference = value[field];
    if (reference && reference.mime !== "image/jpeg" && reference.mime !== "image/png") {
      context.addIssue({ code: "custom", path: [field, "mime"], message: "Veo conditioning artifact must be JPEG or PNG" });
    }
    if (reference && reference.sizeBytes > 20 * 1024 * 1024) {
      context.addIssue({ code: "custom", path: [field, "sizeBytes"], message: "Veo conditioning artifact must not exceed 20 MB" });
    }
  }
  if (value.negativePrompt) {
    context.addIssue({ code: "custom", path: ["negativePrompt"], message: "negative prompt is unavailable until its real provider path is implemented" });
  }
});

export const generatedMusicSpecSchema = z.object({
  modelCapability: z.enum(["lyria-3-clip", "lyria-3-pro", "lyria-2"]),
  prompt: z.string().min(1).max(4000),
  conditioningImageArtifactId: z.string().min(1).optional(),
  instrumental: z.boolean(),
  lyricsMode: z.enum(["none", "generated", "provided"]),
  providedLyrics: z.string().min(1).max(12000).optional(),
  language: z.string().min(2).max(20),
  genre: z.string().min(1).max(200).optional(),
  mood: z.string().min(1).max(200).optional(),
  instrumentation: z.array(z.string().min(1).max(100)).max(20).optional(),
  bpm: z.number().int().min(40).max(240).optional(),
  intensity: z.number().min(0).max(1).optional(),
  structure: z.array(z.string().min(1).max(100)).max(20).optional(),
  targetDurationSec: z.number().int().positive().max(184),
  seed: z.number().int().nonnegative().max(4294967295).optional(),
  outputCount: z.literal(1),
}).strict().superRefine((value, context) => {
  const capability = LYRIA_CAPABILITIES[value.modelCapability];
  if (value.instrumental && value.lyricsMode !== "none") context.addIssue({ code: "custom", path: ["lyricsMode"], message: "instrumental music cannot include lyrics" });
  if (value.lyricsMode === "provided" && !value.providedLyrics) context.addIssue({ code: "custom", path: ["providedLyrics"], message: "provided lyrics are required" });
  if (value.lyricsMode !== "provided" && value.providedLyrics) context.addIssue({ code: "custom", path: ["providedLyrics"], message: "provided lyrics require provided mode" });
  if (value.conditioningImageArtifactId && !capability.imageConditioning) context.addIssue({ code: "custom", path: ["conditioningImageArtifactId"], message: "image conditioning is unsupported" });
  if (!value.instrumental && !capability.vocals) context.addIssue({ code: "custom", path: ["instrumental"], message: "vocals are unsupported" });
  if ((value.structure?.length || value.bpm || value.intensity !== undefined) && !capability.structure) context.addIssue({ code: "custom", path: ["structure"], message: "structure controls are unsupported" });
  if (
    value.conditioningImageArtifactId || !value.instrumental || value.lyricsMode !== "none"
    || value.genre || value.mood || value.instrumentation?.length || value.bpm
    || value.intensity !== undefined || value.structure?.length || value.seed !== undefined
  ) context.addIssue({ code: "custom", path: ["conditioningImageArtifactId"], message: "advanced Lyria conditioning and music controls are unavailable until their real provider path is implemented" });
  const maximum = Math.max(...capability.durations);
  if (value.targetDurationSec > maximum) context.addIssue({ code: "custom", path: ["targetDurationSec"], message: `duration exceeds ${maximum} seconds` });
  if (value.modelCapability === "lyria-3-clip" && value.targetDurationSec !== 30) {
    context.addIssue({ code: "custom", path: ["targetDurationSec"], message: "Lyria 3 Clip always generates a 30-second provider output" });
  }
});

const sourceWindowSchema = z.object({
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
}).strict();

const reframeSchema = z.object({
  xPercent: z.number().min(0).max(100),
  yPercent: z.number().min(0).max(100),
  scale: z.number().min(1).max(4),
}).strict();

const captionSchema = z.object({
  id: identifier,
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
  text: z.string().min(1).max(500),
  sourceSegmentRefs: z.array(identifier).min(1).max(20),
}).strict();

const sceneSchema = z.object({
  id: identifier, order: z.number().int().positive(), startSec: z.number().nonnegative(), durationSec: z.number().positive(),
  purpose: z.string().min(1), sourceArtifact: verifiedProductionArtifactRefSchema.optional(), video: generatedVideoSpecSchema.optional(),
  sourceWindow: sourceWindowSchema.optional(), sourceSegmentRefs: z.array(identifier).min(1).max(100).optional(),
  preserveSourceAudio: z.boolean().optional(), reframe: reframeSchema.optional(),
  overlays: z.array(z.record(z.string(), z.unknown())), captions: z.array(captionSchema), transitions: z.array(z.record(z.string(), z.unknown())),
}).strict().superRefine((value, context) => {
  if (Boolean(value.sourceArtifact) === Boolean(value.video)) {
    context.addIssue({ code: "custom", path: ["sourceArtifact"], message: "scene requires exactly one verified source artifact or generated video" });
  }
  if (value.sourceArtifact && !value.sourceArtifact.mime.startsWith("video/")) {
    context.addIssue({ code: "custom", path: ["sourceArtifact", "mime"], message: "scene source artifact must be video" });
  }
  const sourceOnlyFields = [value.sourceWindow, value.sourceSegmentRefs, value.preserveSourceAudio, value.reframe];
  if (value.sourceArtifact) {
    if (!value.sourceWindow) context.addIssue({ code: "custom", path: ["sourceWindow"], message: "source artifact scene requires a sealed source window" });
    if (!value.sourceSegmentRefs?.length) context.addIssue({ code: "custom", path: ["sourceSegmentRefs"], message: "source artifact scene requires source segment lineage" });
    if (value.preserveSourceAudio === undefined) context.addIssue({ code: "custom", path: ["preserveSourceAudio"], message: "source artifact scene must seal source audio handling" });
    if (!value.reframe) context.addIssue({ code: "custom", path: ["reframe"], message: "source artifact scene requires a deterministic reframe" });
    if (value.sourceWindow && value.durationSec > value.sourceWindow.durationSec) {
      context.addIssue({ code: "custom", path: ["sourceWindow", "durationSec"], message: "source window must cover the authored scene duration" });
    }
    for (const [index, caption] of value.captions.entries()) {
      if (caption.startSec + caption.durationSec > value.durationSec) {
        context.addIssue({ code: "custom", path: ["captions", index], message: "caption extends beyond its scene window" });
      }
      if (caption.sourceSegmentRefs.some((id) => !value.sourceSegmentRefs?.includes(id))) {
        context.addIssue({ code: "custom", path: ["captions", index, "sourceSegmentRefs"], message: "caption lineage must be contained by scene source segment lineage" });
      }
    }
  } else if (sourceOnlyFields.some((field) => field !== undefined)) {
    context.addIssue({ code: "custom", path: ["sourceArtifact"], message: "source-only edit fields require a verified source artifact" });
  }
});

const narrationClipSchema = z.object({
  id: identifier,
  artifact: verifiedProductionArtifactRefSchema,
  startSec: z.number().nonnegative(),
  durationSec: z.number().positive(),
}).strict().superRefine((value, context) => {
  if (!value.artifact.mime.startsWith("audio/")) {
    context.addIssue({ code: "custom", path: ["artifact", "mime"], message: "narration artifact must be audio" });
  }
});

export const videoProductionPlanSchema = z.object({
  id: identifier, jobId: identifier, workspaceId: identifier, brandId: identifier, revision: z.number().int().positive(),
  goal: z.string().min(1), audience: z.string().min(1), tone: z.array(z.string().min(1)).min(1),
  target: z.object({ platform: z.string().min(1), durationSec: z.number().positive(), aspectRatio: z.enum(["16:9", "9:16"]), resolution: z.enum(["720p", "1080p", "4k"]), frameRate: z.union([z.literal(24), z.literal(25), z.literal(30), z.literal(60)]), format: z.literal("mp4") }).strict(),
  scenes: z.array(sceneSchema).min(1), narration: z.array(narrationClipSchema).max(100), soundtrack: generatedMusicSpecSchema.optional(),
  constraints: z.object({ allowLikeness: z.boolean(), allowGeneratedVocals: z.boolean(), requireLicensedSources: z.boolean() }).strict(),
  pricingVersion: z.string().min(1), operationCostsUsd: z.record(z.string().regex(/^[A-Za-z0-9:_-]{1,512}$/), usd), estimatedCostUsd: usd, maximumCostUsd: usd,
}).strict().superRefine((value, context) => {
  if (Number(value.maximumCostUsd) < Number(value.estimatedCostUsd)) context.addIssue({ code: "custom", path: ["maximumCostUsd"], message: "maximum cost must cover estimated cost" });
  if (!value.constraints.allowGeneratedVocals && value.soundtrack && !value.soundtrack.instrumental) context.addIssue({ code: "custom", path: ["soundtrack"], message: "generated vocals are forbidden by the plan" });
  for (const [index, clip] of value.narration.entries()) {
    if (clip.startSec + clip.durationSec > value.target.durationSec) {
      context.addIssue({
        code: "custom",
        path: ["narration", index, "durationSec"],
        message: "narration clip extends beyond the target timeline",
      });
    }
  }
  const artifactIdentities = new Map<string, string>();
  const references = [
    ...value.scenes.flatMap((scene) => scene.sourceArtifact ? [scene.sourceArtifact] : []),
    ...value.scenes.flatMap((scene) => scene.video
      ? [scene.video.sourceImageArtifact, scene.video.lastFrameArtifact].filter(
        (reference): reference is VerifiedProductionArtifactRef => Boolean(reference),
      )
      : []),
    ...value.narration.map((clip) => clip.artifact),
  ];
  for (const reference of references) {
    const identity = canonical(reference);
    const existing = artifactIdentities.get(reference.artifactId);
    if (existing && existing !== identity) {
      context.addIssue({ code: "custom", path: ["scenes"], message: `artifact ${reference.artifactId} has conflicting sealed identities` });
    }
    artifactIdentities.set(reference.artifactId, identity);
  }
  const requiredOperationIds = value.scenes.flatMap((scene) => {
    if (!scene.video) return [];
    const type = scene.video.mode === "extend_video" ? "extend_video" : "generate_video";
    return [`${value.id}:${type}:${scene.id}`];
  });
  if (value.soundtrack) requiredOperationIds.push(`${value.id}:generate_music`);
  requiredOperationIds.sort();
  const quotedOperationIds = Object.keys(value.operationCostsUsd).sort();
  const quotedMicros = Object.values(value.operationCostsUsd).reduce((total, cost) => total + BigInt(cost.replace(".", "")), BigInt(0));
  const estimatedMicros = BigInt(value.estimatedCostUsd.replace(".", ""));
  if (JSON.stringify(requiredOperationIds) !== JSON.stringify(quotedOperationIds) || quotedMicros !== estimatedMicros) {
    context.addIssue({ code: "custom", path: ["operationCostsUsd"], message: "operation cost quotes must exactly fund the paid operation graph" });
  }
});

export type GeneratedVideoSpec = z.infer<typeof generatedVideoSpecSchema>;
export type GeneratedMusicSpec = z.infer<typeof generatedMusicSpecSchema>;
export type VideoProductionPlan = z.infer<typeof videoProductionPlanSchema>;

const operationTypes = ["extract_source_segment", "normalize_media", "generate_video", "extend_video", "generate_music", "generate_image", "generate_voice", "resolve_media", "build_composition", "render_composition", "mix_audio", "ffmpeg_finalize", "inspect_media", "evaluate_production", "repair_media", "inspect_delivery", "evaluate_delivery", "assemble_export", "publish_external"] as const;
export const productionOperationSchema = z.object({ id: z.string().min(1), jobId: z.string().min(1), type: z.enum(operationTypes), dependsOn: z.array(z.string().min(1)), payload: z.record(z.string(), z.unknown()), requestDigest: digest, estimatedCostUsd: usd.optional(), executionAuthority: z.enum(["production_mandate", "internal", "publication_approval"]) }).strict().superRefine((value, context) => {
  if (value.executionAuthority === "production_mandate" && !value.estimatedCostUsd) context.addIssue({ code: "custom", path: ["estimatedCostUsd"], message: "paid operation requires a sealed cost quote" });
  if (value.executionAuthority !== "production_mandate" && value.estimatedCostUsd) context.addIssue({ code: "custom", path: ["estimatedCostUsd"], message: "only paid operations carry cost quotes" });
});
export type ProductionOperation = z.infer<typeof productionOperationSchema>;

export const mediaOperationSchema = z.object({
  id: z.string().min(1), jobId: z.string().min(1), actionId: z.string().min(1), provider: z.enum(["veo", "lyria"]),
  state: z.enum(["prepared", "budget_reserved", "provider_submitted", "provider_pending", "provider_succeeded", "artifact_ingested", "independently_verified", "applied", "policy_filtered", "permanent_failure", "cancelled_before_submission", "unknown_after_submission"]),
  providerOperationId: z.string().min(1).optional(), attempt: z.number().int().nonnegative(), requestDigest: digest, estimatedCostUsd: usd,
  artifactId: z.string().min(1).optional(), artifactDigest: digest.optional(), createdAt: z.string().datetime({ offset: true }), updatedAt: z.string().datetime({ offset: true }),
}).strict();
export type MediaOperation = z.infer<typeof mediaOperationSchema>;
export type MediaOperationState = MediaOperation["state"];

export const productionMandateSchema = z.object({
  id: z.string().min(1),
  planId: z.string().min(1),
  planDigest: digest,
  planRevision: z.number().int().positive(),
  jobId: z.string().min(1),
  workspaceId: z.string().min(1),
  brandId: z.string().min(1),
  operatorSubjectId: z.string().min(1),
  authenticationId: z.string().min(1),
  maximumCostUsd: usd,
  paidOperationDigests: z.array(digest).min(1),
  approvedAt: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true }),
  mandateDigest: digest,
}).strict();
export type ProductionMandate = z.infer<typeof productionMandateSchema>;

const mediaTransitions: Record<MediaOperationState, readonly MediaOperationState[]> = {
  prepared: ["budget_reserved", "cancelled_before_submission"],
  budget_reserved: ["provider_submitted", "cancelled_before_submission", "permanent_failure"],
  provider_submitted: ["provider_pending", "provider_succeeded", "policy_filtered", "permanent_failure", "unknown_after_submission"],
  provider_pending: ["provider_pending", "provider_succeeded", "policy_filtered", "permanent_failure", "unknown_after_submission"],
  provider_succeeded: ["artifact_ingested", "permanent_failure"],
  artifact_ingested: ["independently_verified", "permanent_failure"],
  independently_verified: ["applied"],
  applied: [], policy_filtered: [], permanent_failure: [], cancelled_before_submission: [], unknown_after_submission: [],
};

export function transitionMediaOperation(operation: MediaOperation, state: MediaOperationState, updatedAt: string): MediaOperation {
  if (!mediaTransitions[operation.state].includes(state)) throw new Error(`invalid media operation transition: ${operation.state} -> ${state}`);
  if (["provider_submitted", "provider_pending", "provider_succeeded"].includes(state) && !operation.providerOperationId) throw new Error("provider operation id is required after submission");
  return mediaOperationSchema.parse({ ...operation, state, updatedAt });
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") { if (!Number.isFinite(value)) throw new Error("non-finite number"); return JSON.stringify(value); }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  throw new Error("unsupported canonical value");
}

const sha = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
export function generatedMediaRequestDigest(spec: GeneratedVideoSpec | GeneratedMusicSpec): string { return sha(spec); }
export function productionPlanDigest(plan: VideoProductionPlan): string { return sha(videoProductionPlanSchema.parse(plan)); }

export function productionApprovalStillValid(
  approval: { planDigest: string; planRevision: number; expiresAt: string; paidOperationDigests?: string[] },
  plan: VideoProductionPlan,
  now = new Date(),
): boolean {
  const paidOperationDigests = compileProductionOperations(plan)
    .filter((operation) => operation.executionAuthority === "production_mandate")
    .map((operation) => operation.requestDigest);
  return approval.planRevision === plan.revision
    && approval.planDigest === productionPlanDigest(plan)
    && new Date(approval.expiresAt).getTime() > now.getTime()
    && (approval.paidOperationDigests === undefined || canonical(approval.paidOperationDigests) === canonical(paidOperationDigests));
}

export function createProductionMandate(
  plan: VideoProductionPlan,
  approval: { operatorSubjectId: string; authenticationId: string; approvedAt: string; expiresAt: string },
): ProductionMandate {
  const parsed = videoProductionPlanSchema.parse(plan);
  if (Date.parse(approval.expiresAt) <= Date.parse(approval.approvedAt)) throw new Error("production approval expiry must follow approval time");
  const paidOperationDigests = compileProductionOperations(parsed)
    .filter((operation) => operation.executionAuthority === "production_mandate")
    .map((operation) => operation.requestDigest);
  if (paidOperationDigests.length === 0) throw new Error("production mandate requires at least one paid operation");
  const unsigned = {
    id: `${parsed.id}:mandate:v${parsed.revision}`,
    planId: parsed.id,
    planDigest: productionPlanDigest(parsed),
    planRevision: parsed.revision,
    jobId: parsed.jobId,
    workspaceId: parsed.workspaceId,
    brandId: parsed.brandId,
    operatorSubjectId: approval.operatorSubjectId,
    authenticationId: approval.authenticationId,
    maximumCostUsd: parsed.maximumCostUsd,
    paidOperationDigests,
    approvedAt: approval.approvedAt,
    expiresAt: approval.expiresAt,
  };
  return productionMandateSchema.parse({ ...unsigned, mandateDigest: sha(unsigned) });
}

export function assertProductionMandateAuthorizes(input: {
  mandate: ProductionMandate;
  plan: VideoProductionPlan;
  operation: ProductionOperation;
  activeMandateId: string | null;
  workspaceId: string;
  brandId: string;
  now?: Date;
}): ProductionOperation {
  const mandate = productionMandateSchema.parse(input.mandate);
  const plan = videoProductionPlanSchema.parse(input.plan);
  const operation = productionOperationSchema.parse(input.operation);
  if (input.activeMandateId !== mandate.id) throw new Error("production mandate is inactive");
  if (
    mandate.workspaceId !== input.workspaceId
    || mandate.brandId !== input.brandId
    || plan.workspaceId !== input.workspaceId
    || plan.brandId !== input.brandId
  ) throw new Error("production mandate tenant scope mismatch");
  if (mandate.jobId !== plan.jobId || operation.jobId !== plan.jobId) {
    throw new Error("production mandate job scope mismatch");
  }
  const { mandateDigest, ...unsigned } = mandate;
  if (sha(unsigned) !== mandateDigest) throw new Error("production mandate digest mismatch");
  const now = input.now ?? new Date();
  if (Date.parse(mandate.approvedAt) > now.getTime()) throw new Error("production mandate is not active yet");
  if (Date.parse(mandate.expiresAt) <= now.getTime()) throw new Error("production mandate expired");
  if (!productionApprovalStillValid(mandate, plan, now)) {
    throw new Error("production mandate does not authorize the current plan");
  }
  if (operation.executionAuthority !== "production_mandate") {
    throw new Error("production mandate authorizes only a paid operation");
  }
  const compiled = compileProductionOperations(plan).find((candidate) => candidate.id === operation.id);
  if (!compiled || canonical(compiled) !== canonical(operation)) {
    throw new Error("production operation is not in the sealed graph");
  }
  if (!mandate.paidOperationDigests.includes(operation.requestDigest)) {
    throw new Error("paid operation digest is not authorized");
  }
  return input.operation;
}

export function estimateGeneratedMediaCost(spec: GeneratedVideoSpec | GeneratedMusicSpec, overrides: Record<string, string> = {}): string {
  if ("mode" in spec) {
    const rate = VEO_CAPABILITIES[spec.modelCapability].usdPerSecond;
    if (!rate) throw new Error(`pricing unavailable for ${spec.modelCapability}`);
    return (Number(rate) * spec.durationSec).toFixed(6);
  }
  const configured = overrides[spec.modelCapability] ?? LYRIA_CAPABILITIES[spec.modelCapability].fixedCostUsd;
  if (!configured) throw new Error(`pricing unavailable for ${spec.modelCapability}`);
  return Number(configured).toFixed(6);
}

export function compileProductionOperations(plan: VideoProductionPlan): ProductionOperation[] {
  const compositionReferences = [
    ...plan.scenes.flatMap((scene) => scene.sourceArtifact ? [scene.sourceArtifact] : []),
    ...plan.narration.map((clip) => clip.artifact),
  ];
  const conditioningReferences = plan.scenes.flatMap((scene) => scene.video
    ? [scene.video.sourceImageArtifact, scene.video.lastFrameArtifact].filter(
      (reference): reference is VerifiedProductionArtifactRef => Boolean(reference),
    )
    : []);
  const references = [...compositionReferences, ...conditioningReferences];
  const uniqueReferences = [...new Map(references.map((reference) => [reference.artifactId, reference])).values()];
  const resolved: ProductionOperation[] = uniqueReferences.map((reference) => ({
    id: `${plan.id}:resolve_media:${reference.artifactId}`,
    jobId: plan.jobId,
    type: "resolve_media",
    dependsOn: [],
    payload: reference,
    requestDigest: sha(reference),
    executionAuthority: "internal",
  }));
  const paid: ProductionOperation[] = [];
  for (const scene of [...plan.scenes].sort((a, b) => a.order - b.order)) if (scene.video) {
    const type = scene.video.mode === "extend_video" ? "extend_video" : "generate_video";
    const id = `${plan.id}:${type}:${scene.id}`;
    const requestDigest = generatedMediaRequestDigest(scene.video);
    const conditioningIds = [scene.video.sourceImageArtifact, scene.video.lastFrameArtifact]
      .filter((reference): reference is VerifiedProductionArtifactRef => Boolean(reference))
      .map((reference) => `${plan.id}:resolve_media:${reference.artifactId}`);
    paid.push({ id, jobId: plan.jobId, type, dependsOn: conditioningIds, payload: scene.video, requestDigest, estimatedCostUsd: plan.operationCostsUsd[id], executionAuthority: "production_mandate" });
  }
  if (plan.soundtrack) {
    const id = `${plan.id}:generate_music`;
    const requestDigest = generatedMediaRequestDigest(plan.soundtrack);
    paid.push({ id, jobId: plan.jobId, type: "generate_music", dependsOn: [], payload: plan.soundtrack, requestDigest, estimatedCostUsd: plan.operationCostsUsd[id], executionAuthority: "production_mandate" });
  }
  const buildId = `${plan.id}:build_composition`;
  const chain: ProductionOperation[] = [
    { id: buildId, jobId: plan.jobId, type: "build_composition", dependsOn: [
      ...compositionReferences.map((reference) => `${plan.id}:resolve_media:${reference.artifactId}`),
      ...paid.map((item) => item.id),
    ], payload: { planDigest: productionPlanDigest(plan) }, requestDigest: sha({ planDigest: productionPlanDigest(plan) }), executionAuthority: "internal" },
  ];
  for (const type of ["render_composition", "mix_audio", "ffmpeg_finalize", "inspect_media", "evaluate_production"] as const) {
    const previous = chain.at(-1)!.id;
    const id = `${plan.id}:${type}`;
    chain.push({ id, jobId: plan.jobId, type, dependsOn: [previous], payload: { planDigest: productionPlanDigest(plan) }, requestDigest: sha({ type, planDigest: productionPlanDigest(plan) }), executionAuthority: "internal" });
  }
  const planDigest = productionPlanDigest(plan);
  const repairId = `${plan.id}:repair_media`;
  chain.push({
    id: repairId,
    jobId: plan.jobId,
    type: "repair_media",
    dependsOn: [`${plan.id}:ffmpeg_finalize`, `${plan.id}:evaluate_production`],
    payload: { planDigest },
    requestDigest: sha({ type: "repair_media", planDigest }),
    executionAuthority: "internal",
  });
  for (const type of ["inspect_delivery", "evaluate_delivery"] as const) {
    const previous = chain.at(-1)!.id;
    const id = `${plan.id}:${type}`;
    chain.push({
      id, jobId: plan.jobId, type, dependsOn: [previous], payload: { planDigest },
      requestDigest: sha({ type, planDigest }), executionAuthority: "internal",
    });
  }
  const exportType = "assemble_export" as const;
  chain.push({
    id: `${plan.id}:${exportType}`,
    jobId: plan.jobId,
    type: exportType,
    dependsOn: [repairId, `${plan.id}:evaluate_delivery`],
    payload: { planDigest },
    requestDigest: sha({ type: exportType, planDigest }),
    executionAuthority: "internal",
  });
  return [...resolved, ...paid, ...chain];
}
