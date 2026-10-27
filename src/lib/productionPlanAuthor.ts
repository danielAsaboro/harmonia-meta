import { createHash } from "node:crypto";
import { z } from "zod";
import { getConfig } from "@/lib/config";
import { videoProductionPlanSchema, type VideoProductionPlan } from "@/lib/mediaProduction";
import { createChatCompletion } from "@/lib/metaChatCompletion";

const creativeDraftSchema = z.object({
  goal: z.string().min(1).max(500),
  audience: z.string().min(1).max(500),
  tone: z.array(z.string().min(1).max(100)).min(1).max(8),
  platform: z.string().min(1).max(100),
  aspectRatio: z.enum(["16:9", "9:16"]),
  resolution: z.enum(["720p", "1080p"]),
  frameRate: z.union([z.literal(24), z.literal(30)]),
  scenes: z.array(z.object({
    purpose: z.string().min(1).max(500),
    prompt: z.string().min(1).max(4000),
    durationSec: z.union([z.literal(4), z.literal(6), z.literal(8)]),
  }).strict()).min(1).max(3),
  soundtrack: z.object({ include: z.boolean(), prompt: z.string().min(1).max(4000).nullish() }).strict(),
}).strict().superRefine((value, context) => {
  if (value.soundtrack.include && !value.soundtrack.prompt) {
    context.addIssue({ code: "custom", path: ["soundtrack", "prompt"], message: "soundtrack prompt required" });
  }
});

export type ProductionCreativeDraft = z.infer<typeof creativeDraftSchema>;
type JobContext = { id: string; sourceAnalysis?: unknown; contentStrategy?: unknown; contentArtifacts?: unknown };
type DraftGenerator = (input: {
  request: string;
  job: JobContext;
  existing?: VideoProductionPlan;
}) => Promise<ProductionCreativeDraft>;
export interface ProductionPricingCatalog {
  version: string;
  veo31FastUsdPerSecond: string;
  lyria3ClipFixedUsd: string;
}

const priceSchema = z.string().regex(/^\d+\.\d{6}$/).refine((value) => BigInt(value.replace(".", "")) > BigInt(0));

function productionPricingCatalog(configured?: ProductionPricingCatalog): ProductionPricingCatalog {
  if (configured) {
    if (!priceSchema.safeParse(configured.veo31FastUsdPerSecond).success) throw new Error("Veo 3.1 Fast pricing is unavailable");
    if (!priceSchema.safeParse(configured.lyria3ClipFixedUsd).success) throw new Error("Lyria 3 Clip pricing is unavailable");
    if (!configured.version.trim()) throw new Error("media pricing version is unavailable");
    return configured;
  }
  const config = getConfig();
  if (!config.VEO_3_1_COST_PER_SECOND_USD) throw new Error("Veo 3.1 Fast pricing is unavailable");
  if (!config.LYRIA_3_CLIP_COST_USD) throw new Error("Lyria 3 Clip pricing is unavailable");
  return {
    version: config.MODEL_PRICING_VERSION,
    veo31FastUsdPerSecond: config.VEO_3_1_COST_PER_SECOND_USD,
    lyria3ClipFixedUsd: config.LYRIA_3_CLIP_COST_USD,
  };
}

// Strict-subset JSON Schema (docs/meta-model-api/structured-output.md "Enforce strict mode"):
// every object closes additionalProperties and lists every property as required.
const creativeDraftJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    goal: { type: "string" }, audience: { type: "string" },
    tone: { type: "array", items: { type: "string" } }, platform: { type: "string" },
    aspectRatio: { type: "string", enum: ["16:9", "9:16"] },
    resolution: { type: "string", enum: ["720p", "1080p"] },
    frameRate: { type: "integer", enum: [24, 30] },
    scenes: { type: "array", maxItems: 3, items: {
      type: "object", additionalProperties: false,
      properties: { purpose: { type: "string" }, prompt: { type: "string" }, durationSec: { type: "integer", enum: [4, 6, 8] } },
      required: ["purpose", "prompt", "durationSec"],
    } },
    soundtrack: {
      type: "object", additionalProperties: false,
      properties: { include: { type: "boolean" }, prompt: { anyOf: [{ type: "string" }, { type: "null" }] } },
      required: ["include", "prompt"],
    },
  },
  required: ["goal", "audience", "tone", "platform", "aspectRatio", "resolution", "frameRate", "scenes", "soundtrack"],
};

async function generateCreativeDraft(input: {
  request: string;
  job: JobContext;
  existing?: VideoProductionPlan;
}): Promise<ProductionCreativeDraft> {
  const groundedContext = JSON.stringify({
    sourceAnalysis: input.job.sourceAnalysis ?? null,
    contentStrategy: input.job.contentStrategy ?? null,
    contentArtifacts: input.job.contentArtifacts ?? null,
    existingPlan: input.existing ?? null,
  });
  const prompt = `Create a concise supported media-production creative draft from the operator request and supplied job evidence. Use only text-to-video shots. Each shot must be 4, 6, or 8 seconds; use at most three. Use 720p or 1080p and 16:9 or 9:16. Include a soundtrack only when it materially serves the request; it must be instrumental. Set soundtrack.prompt to null when no soundtrack is included. Do not invent source facts, likeness permissions, provider completion, costs, IDs, or approval. Operator request:\n${input.request}\nGrounded job evidence:\n${groundedContext}`;
  const text = await createChatCompletion({
    purpose: "production planning",
    messages: [
      { role: "system", content: "You are Harmonia's bounded media production planner. Return JSON only and obey the supplied capability envelope." },
      { role: "user", content: prompt },
    ],
    responseFormat: {
      type: "json_schema",
      json_schema: { name: "ProductionCreativeDraft", schema: creativeDraftJsonSchema, strict: true },
    },
    timeoutMs: 30_000,
  });
  return creativeDraftSchema.parse(JSON.parse(text));
}

function usdFromMicros(micros: bigint): string {
  const value = micros.toString().padStart(7, "0");
  return `${value.slice(0, -6)}.${value.slice(-6)}`;
}

function stablePlanId(jobId: string): string {
  return `media-${createHash("sha256").update(jobId).digest("hex").slice(0, 24)}`;
}

export async function authorProductionPlan(input: {
  job: JobContext;
  workspaceId: string;
  brandId: string;
  request: string;
  existing?: VideoProductionPlan;
  generateDraft?: DraftGenerator;
  pricing?: ProductionPricingCatalog;
}): Promise<VideoProductionPlan> {
  const request = input.request.trim();
  if (!request) throw new Error("production plan request is required");
  const draft = creativeDraftSchema.parse(await (input.generateDraft ?? generateCreativeDraft)({
    request, job: input.job, ...(input.existing ? { existing: input.existing } : {}),
  }));
  const id = input.existing?.id ?? stablePlanId(input.job.id);
  const revision = (input.existing?.revision ?? 0) + 1;
  const pricing = productionPricingCatalog(input.pricing);
  let startSec = 0;
  const operationCostsUsd: Record<string, string> = {};
  const scenes = draft.scenes.map((scene, index) => {
    const sceneId = `scene-${index + 1}`;
    const cost = usdFromMicros(BigInt(scene.durationSec) * BigInt(pricing.veo31FastUsdPerSecond.replace(".", "")));
    operationCostsUsd[`${id}:generate_video:${sceneId}`] = cost;
    const result = {
      id: sceneId, order: index + 1, startSec, durationSec: scene.durationSec,
      purpose: scene.purpose,
      video: {
        modelCapability: "veo-3.1-fast" as const, mode: "text_to_video" as const,
        prompt: scene.prompt, durationSec: scene.durationSec,
        aspectRatio: draft.aspectRatio, resolution: draft.resolution,
        generateAudio: false, enhancePrompt: true, outputCount: 1 as const,
      },
      overlays: [], captions: [], transitions: [],
    };
    startSec += scene.durationSec;
    return result;
  });
  const soundtrack = draft.soundtrack.include ? {
    modelCapability: "lyria-3-clip" as const,
    prompt: draft.soundtrack.prompt!, instrumental: true, lyricsMode: "none" as const,
    language: "en", targetDurationSec: 30, outputCount: 1 as const,
  } : undefined;
  if (soundtrack) operationCostsUsd[`${id}:generate_music`] = pricing.lyria3ClipFixedUsd;
  const estimatedMicros = Object.values(operationCostsUsd)
    .reduce((sum, cost) => sum + BigInt(cost.replace(".", "")), BigInt(0));
  const estimatedCostUsd = usdFromMicros(estimatedMicros);
  return videoProductionPlanSchema.parse({
    id, jobId: input.job.id, workspaceId: input.workspaceId, brandId: input.brandId, revision,
    goal: draft.goal, audience: draft.audience, tone: draft.tone,
    target: { platform: draft.platform, durationSec: startSec, aspectRatio: draft.aspectRatio, resolution: draft.resolution, frameRate: draft.frameRate, format: "mp4" },
    scenes, narration: [], ...(soundtrack ? { soundtrack } : {}),
    constraints: { allowLikeness: false, allowGeneratedVocals: false, requireLicensedSources: true },
    pricingVersion: pricing.version, operationCostsUsd,
    estimatedCostUsd, maximumCostUsd: estimatedCostUsd,
  });
}
