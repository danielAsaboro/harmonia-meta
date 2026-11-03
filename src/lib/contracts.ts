import { z } from "zod";
import { searchProvenanceSchema } from "./searchProvenance";

export const sourceInputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("youtube"), url: z.string().url(), rightsAuthorizationId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("web"), url: z.string().url(), rightsAuthorizationId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("upload"), attachmentId: z.string().min(1), rightsAuthorizationId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal("pasted_text"), title: z.string().min(1).max(300), text: z.string().min(1), rightsAuthorizationId: z.string().min(1) }).strict(),
]);

export const OUTPUT_KINDS = [
  "x_post", "x_thread", "linkedin_post", "blog_article", "newsletter", "caption", "carousel_spec", "social_image",
  "quote_card", "diagram", "short_clip", "reel", "generated_video", "generated_music", "editorial_calendar", "content_pack",
] as const;
export const outputKindSchema = z.enum(OUTPUT_KINDS);

export const createJobInputSchema = z.object({
  operatorBrief: z.string().min(1).max(2000).optional(),
  librarySnapshotId: z.string().min(1).optional(),
  directSources: z.array(sourceInputSchema).max(10).default([]),
  desiredOutputs: z.array(outputKindSchema).min(1),
  allowedOutputs: z.array(outputKindSchema).min(1).optional(),
  strategyContext: z.lazy(() => strategyContextSchema).optional(),
  analysisResearchRequest: z.lazy(() => analysisResearchRequestSchema).optional(),
  platforms: z.array(z.string().min(1)).default([]),
}).strict().superRefine((value, context) => {
  if (!value.librarySnapshotId && value.directSources.length === 0) {
    context.addIssue({ code: "custom", path: ["directSources"], message: "a library snapshot or direct source is required" });
  }
  if (value.allowedOutputs) {
    const allowed = new Set(value.allowedOutputs);
    for (const output of value.desiredOutputs) {
      if (!allowed.has(output)) context.addIssue({ code: "custom", path: ["desiredOutputs"], message: `${output} is not allowed` });
    }
  }
});

const increasingRange = <T extends z.ZodRawShape>(shape: T, startKey: keyof T & string, endKey: keyof T & string) =>
  z.object(shape).strict().superRefine((value, context) => {
    const range = value as Record<string, unknown>;
    if ((range[endKey] as number) < (range[startKey] as number)) {
      context.addIssue({ code: "custom", path: [endKey], message: "range end must not precede start" });
    }
  });

export const evidenceLocatorSchema = z.discriminatedUnion("kind", [
  increasingRange({ kind: z.literal("time_range"), startMs: z.number().int().nonnegative(), endMs: z.number().int().nonnegative() }, "startMs", "endMs"),
  z.object({ kind: z.literal("frame"), timestampMs: z.number().int().nonnegative(), frameArtifactId: z.string().min(1) }).strict(),
  increasingRange({ kind: z.literal("page_range"), startPage: z.number().int().positive(), endPage: z.number().int().positive() }, "startPage", "endPage"),
  increasingRange({ kind: z.literal("paragraph_range"), startParagraph: z.number().int().positive(), endParagraph: z.number().int().positive() }, "startParagraph", "endParagraph"),
  increasingRange({ kind: z.literal("line_range"), startLine: z.number().int().positive(), endLine: z.number().int().positive() }, "startLine", "endLine"),
  z.object({ kind: z.literal("section"), heading: z.string().min(1), occurrence: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("url_fragment"), canonicalUrl: z.string().url(), fragment: z.string().min(1) }).strict(),
]);

export const contentSegmentSchema = z.object({
  id: z.string().min(1), text: z.string().min(1), locator: evidenceLocatorSchema, digest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const normalizedSourceSchema = z.object({
  sourceId: z.string().min(1),
  sourceKind: z.enum(["video", "audio", "document", "web", "text"]),
  title: z.string().min(1),
  mimeType: z.string().min(1),
  contentDigest: z.string().regex(/^[a-f0-9]{64}$/),
  extractorVersion: z.string().min(1),
  extractedAt: z.string().datetime({ offset: true }),
  segments: z.array(contentSegmentSchema).min(1),
  metadata: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
  extractionReceiptId: z.string().min(1),
}).strict();

export const sourceExclusionRecordSchema = z.object({
  sourceId: z.string().min(1), reason: z.string().min(1).max(500), excludedAt: z.string().datetime({ offset: true }), excludedBySubjectId: z.string().min(1),
}).strict();

export const jobSourceManifestSchema = z.object({
  id: z.string().min(1), jobId: z.string().min(1), revision: z.number().int().positive(),
  librarySnapshotId: z.string().min(1).optional(), directSourceIds: z.array(z.string().min(1)).max(10),
  excludedSourceIds: z.array(z.string().min(1)), exclusionRecords: z.array(sourceExclusionRecordSchema),
  digest: z.string().regex(/^[a-f0-9]{64}$/), sealedAt: z.string().datetime({ offset: true }), sealedBySubjectId: z.string().min(1),
}).strict();

const usdDecimalSchema = z.string().regex(/^\d+\.\d{1,6}$/);

const modelPolicySchema = z.object({
  policyVersion: z.string().min(1),
  pricingVersion: z.string().min(1),
  temperature: z.number().min(0).max(2).nullable(),
  topP: z.number().positive().max(1).nullable(),
  topK: z.number().int().positive().nullable(),
  safetyProfile: z.string().min(1),
  maxOutputTokens: z.number().int().positive(),
  timeoutSeconds: z.number().int().positive(),
  eligibleTasks: z.array(z.string().min(1)).min(1),
  minimumPassRate: z.string().regex(/^(0(\.\d+)?|1(\.0+)?)$/),
}).strict();

export const budgetReservationSchema = z.object({
  jobId: z.string().min(1),
  operationId: z.string().min(1),
  stage: z.string().min(1),
  role: z.string().min(1),
  model: z.string().min(1),
  estimatedCostUsd: usdDecimalSchema,
  pricingVersion: z.string().min(1),
  modelPolicy: modelPolicySchema.optional(),
}).strict();

export const budgetReservationResolutionSchema = z.object({
  jobId: z.string().min(1),
  operationId: z.string().min(1),
  outcome: z.enum(["not_invoked", "uncertain"]),
  reason: z.string().min(10).max(500),
}).strict();

export const stageExecutionClaimSchema = z.object({
  jobId: z.string().min(1),
  stage: z.string().min(1),
  operationId: z.string().min(1).max(500),
  ownerId: z.string().min(1).max(200),
  claimToken: z.string().min(32).max(256),
}).strict();

export const stageExecutionFinalizeSchema = z.object({
  jobId: z.string().min(1),
  stage: z.string().min(1),
  operationId: z.string().min(1).max(500),
  claimToken: z.string().min(32).max(256),
  outcome: z.enum(["applied", "failed", "uncertain"]),
  failureReason: z.string().min(1).max(500).optional(),
}).strict();

export const durableEventEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  source: z.string().min(1).max(100),
  sourceEventId: z.string().min(1).max(512),
  workspaceId: z.string().min(1).max(128),
  brandId: z.string().min(1).max(128),
  jobId: z.string().min(1).max(256),
  eventType: z.string().min(1).max(100),
  operationId: z.string().regex(/^[A-Za-z0-9:_-]{1,512}$/),
  correlationId: z.string().min(1).max(512),
  causationId: z.string().min(1).max(512).optional(),
  attempt: z.number().int().nonnegative().max(100),
  trust: z.enum(["system", "operator", "provider", "external_untrusted", "model_inference"]),
  occurredAt: z.string().datetime({ offset: true }),
  payload: z.record(z.string(), z.unknown()),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();

export const durableEventClaimSchema = z.object({
  envelope: durableEventEnvelopeSchema,
  pubsubMessageId: z.string().min(1).max(512),
  claimToken: z.string().min(32).max(256),
}).strict();

export const durableEventFinalizeSchema = z.object({
  source: z.string().min(1).max(100),
  sourceEventId: z.string().min(1).max(512),
  claimToken: z.string().min(32).max(256),
  outcome: z.enum(["completed", "rejected"]),
  rejectionReason: z.string().min(1).max(500).optional(),
  operationEpoch: z.number().int().positive(),
  operationState: z.enum(["unknown", "succeeded", "failed", "cancelled"]),
  operationReason: z.string().min(1).max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.outcome === "rejected" && !value.rejectionReason) {
    context.addIssue({ code: "custom", path: ["rejectionReason"], message: "rejection reason required" });
  }
  if (value.operationState === "unknown" && !value.operationReason) {
    context.addIssue({ code: "custom", path: ["operationReason"], message: "operation reason required" });
  }
});

export const durableOperationClaimSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9:_-]{1,512}$/),
  ownerId: z.string().min(1).max(200),
  claimToken: z.string().min(32).max(256),
}).strict();

export const durableOperationFinalizeSchema = z.object({
  operationId: z.string().regex(/^[A-Za-z0-9:_-]{1,512}$/),
  epoch: z.number().int().positive(),
  state: z.enum(["waiting", "unknown", "succeeded", "failed", "cancelled"]),
  unresolvedReason: z.string().min(1).max(500).optional(),
  latestProjectionId: z.string().min(1).max(512).optional(),
}).strict().superRefine((value, context) => {
  if (value.state === "unknown" && !value.unresolvedReason) {
    context.addIssue({ code: "custom", path: ["unresolvedReason"], message: "unresolved reason required" });
  }
});

export const usageRecordSchema = z.object({
  id: z.string().min(1),
  jobId: z.string().min(1),
  operationId: z.string().min(1),
  stage: z.string().min(1),
  role: z.string().min(1),
  model: z.string().min(1),
  inputUnits: z.number().int().nonnegative(),
  outputUnits: z.number().int().nonnegative(),
  unitType: z.enum(["tokens", "images", "video_seconds", "audio_seconds", "endpoint_seconds", "media_generations"]),
  estimatedCostUsd: usdDecimalSchema,
  observedCostUsd: usdDecimalSchema.optional(),
  pricingVersion: z.string().min(1),
  modelPolicy: modelPolicySchema.optional(),
  traceId: z.string().regex(/^[0-9a-f]{32}$/),
  createdAt: z.string().datetime({ offset: true }),
}).strict();

export const evidenceRefSchema = z.object({
  kind: z.enum([
    "youtube_api",
    "media_file",
    "gemini_call",
    "x_api",
    "linkedin_api",
    "firestore_doc",
    "http_probe",
    "asset_store",
  ]),
  url: z.string(),
  fetchedAt: z.string(),
  digest: z.string().nullable().optional(),
});

export const momentSchema = z.object({
  id: z.string().min(1).max(100),
  title: z.string().min(1).max(300),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
  hook: z.string().min(1).max(500),
  quote: z.string().min(1).max(2000),
  sourceSegmentRefs: z.array(z.string().min(1).max(100)).min(1).max(500),
  visualHook: z.string().min(1).max(500).optional(),
  cropSuitability: z.enum(["poor", "fair", "good", "excellent"]).optional(),
  captionSafeRegion: z.string().min(1).max(200).optional(),
  visualEvidenceIds: z.array(z.string().min(1).max(100)).max(12),
  assumptions: z.array(z.string().min(1).max(500)).max(8),
  confidence: z.enum(["low", "medium", "high"]),
}).strict().superRefine((moment, context) => {
  if (moment.endSec < moment.startSec) context.addIssue({ code: "custom", message: "moment end must not precede start" });
  if (new Set(moment.sourceSegmentRefs).size !== moment.sourceSegmentRefs.length) context.addIssue({ code: "custom", message: "moment source references must be unique" });
  if (new Set(moment.visualEvidenceIds).size !== moment.visualEvidenceIds.length) context.addIssue({ code: "custom", message: "moment visual references must be unique" });
  if (Boolean(moment.visualHook) !== Boolean(moment.visualEvidenceIds.length)) context.addIssue({ code: "custom", message: "visual hook and evidence must appear together" });
  if (moment.confidence === "high" && moment.assumptions.length) context.addIssue({ code: "custom", message: "high-confidence moment cannot contain assumptions" });
});

export const angleSchema = z.object({
  id: z.string().min(1).max(100),
  angleType: z.enum(["source_insight", "trend", "meme", "performance_learning", "memory_learning"]),
  evidenceKind: z.enum(["source", "public_context", "performance", "memory"]),
  title: z.string().min(1).max(300),
  rationale: z.string().min(1).max(1000),
  evidenceRefs: z.array(z.string().min(1).max(100)).min(1).max(512),
  assumptions: z.array(z.string().min(1).max(500)).max(8),
  confidence: z.enum(["low", "medium", "high"]),
}).strict().superRefine((angle, context) => {
  if (new Set(angle.evidenceRefs).size !== angle.evidenceRefs.length) context.addIssue({ code: "custom", message: "angle evidence references must be unique" });
  if (angle.confidence === "high" && angle.assumptions.length) context.addIssue({ code: "custom", message: "high-confidence angle cannot contain assumptions" });
  const allowed = {
    source_insight: ["source"],
    trend: ["public_context"],
    meme: ["public_context"],
    performance_learning: ["performance"],
    memory_learning: ["memory"],
  } as const;
  if (!(allowed[angle.angleType] as readonly string[]).includes(angle.evidenceKind)) {
    context.addIssue({ code: "custom", message: `${angle.angleType} requires compatible evidence kind` });
  }
});

export const sourceAnalysisSchema = z.object({
  sourceDigest: z.string().regex(/^[0-9a-f]{64}$/),
  summary: z.string().min(1).max(2000),
  moments: z.array(momentSchema).max(12),
  angles: z.array(angleSchema).max(12),
  assumptions: z.array(z.string().min(1).max(500)).max(12),
  confidence: z.enum(["low", "medium", "high"]),
}).strict().superRefine((analysis, context) => {
  const momentIds = analysis.moments.map((item) => item.id);
  const angleIds = analysis.angles.map((item) => item.id);
  if (new Set(momentIds).size !== momentIds.length) context.addIssue({ code: "custom", message: "moment ids must be unique" });
  if (new Set(angleIds).size !== angleIds.length) context.addIssue({ code: "custom", message: "angle ids must be unique" });
  if (momentIds.some((id) => angleIds.includes(id))) context.addIssue({ code: "custom", message: "analysis ids must be globally unique" });
  if (!momentIds.length && !angleIds.length) context.addIssue({ code: "custom", message: "analysis requires evidence" });
  if (analysis.confidence === "high" && analysis.assumptions.length) context.addIssue({ code: "custom", message: "high-confidence analysis cannot contain assumptions" });
});

export const analysisSubmissionSchema = z.object({
  jobId: z.string().min(1),
  stage: z.literal("understand"),
  analysis: sourceAnalysisSchema,
  analysisDigest: z.string().regex(/^[0-9a-f]{64}$/),
  modelUsed: z.string().min(1),
  researchRequest: z.object({
    id: z.string().regex(/^analysis-research-[A-Za-z0-9][A-Za-z0-9._:-]{0,80}$/),
    question: z.string().min(10).max(500),
    justification: z.string().min(10).max(500),
  }).strict().nullable(),
  searchEvidence: z.array(z.object({
    evidenceId: z.string().regex(/^analysis-search-[A-Za-z0-9][A-Za-z0-9._:-]{0,82}$/),
    supportedText: z.string().min(1).max(1000),
    title: z.string().min(1).max(300),
    url: z.string().url().refine((value) => value.startsWith("https://") || value.startsWith("http://")),
  }).strict()).max(8),
  searchProvenance: searchProvenanceSchema.nullable(),
}).strict();

export const analysisResearchRequestSchema = analysisSubmissionSchema.shape.researchRequest.unwrap();

const evidenceRefs = z.array(z.string().min(1).max(100)).min(1).max(12);
const funnelStage = z.enum(["awareness", "consideration", "conversion", "retention", "advocacy"]);
const strategyResearchRequestSchema = z.object({
  id: z.string().regex(/^research-[A-Za-z0-9][A-Za-z0-9._:-]{0,90}$/),
  question: z.string().min(10).max(500), justification: z.string().min(10).max(500),
}).strict();
export const strategyContextSchema = z.object({
  company: z.string().min(1).max(200), product: z.string().min(1).max(500), positioning: z.string().min(1).max(500),
  differentiators: z.array(z.string().min(1).max(300)).min(1).max(8), brandVoice: z.array(z.string().min(1).max(120)).min(1).max(8),
  exclusions: z.array(z.string().min(1).max(300)).max(12).default([]), safetyConstraints: z.array(z.string().min(1).max(300)).max(12).default([]),
  businessObjectives: z.array(z.string().min(1).max(300)).min(1).max(8), campaignObjectives: z.array(z.string().min(1).max(300)).min(1).max(8),
  audiences: z.array(z.object({ id: z.string().min(1).max(100), name: z.string().min(1).max(200), pains: z.array(z.string().min(1).max(300)).min(1).max(8) }).strict()).min(1).max(6),
  funnelStage, intendedConversion: z.string().min(1).max(300), requestedChannels: z.array(z.string().min(1).max(100)).min(1).max(8),
  supportedChannels: z.array(z.string().min(1).max(100)).min(1).max(8), horizonWeeks: z.number().int().min(1).max(12).default(4),
  researchRequest: strategyResearchRequestSchema.optional(),
}).strict();
export const MAX_STRATEGY_SOURCE_IDS = (12 * 500) + (12 * 512) + 24;
export const contentStrategySchema = z.object({
  strategyId: z.string().min(1).max(100), version: z.number().int().min(1).max(2), horizonWeeks: z.number().int().min(1).max(12),
  thesis: z.string().min(1).max(600), differentiatedNarrative: z.string().min(1).max(600),
  objectives: z.array(z.object({ text: z.string().min(1).max(600), evidenceRefs }).strict()).min(1).max(8),
  audiencePriorities: z.array(z.object({ audienceId: z.string().min(1).max(100), priority: z.number().int().min(1).max(5), reason: z.string().min(1).max(500), evidenceRefs }).strict()).min(1).max(6),
  funnelIntent: funnelStage, intendedConversions: z.array(z.string().min(1).max(300)).min(1).max(6),
  pillars: z.array(z.object({ name: z.string().min(1).max(200), purpose: z.string().min(1).max(500), evidenceRefs }).strict()).min(1).max(8),
  campaignThemes: z.array(z.object({ name: z.string().min(1).max(200), message: z.string().min(1).max(500), evidenceRefs }).strict()).min(1).max(8),
  channelRoles: z.array(z.object({ channel: z.string().min(1).max(100), role: z.string().min(1).max(300), operationallySupported: z.boolean(), formats: z.array(z.string().min(1).max(100)).min(1).max(8), cadence: z.string().min(1).max(200), evidenceRefs }).strict()).min(1).max(8),
  contentMix: z.array(z.object({ format: z.string().min(1).max(100), percentage: z.number().int().min(1).max(100) }).strict()).min(1).max(8).refine((items) => items.reduce((sum, item) => sum + item.percentage, 0) === 100, "content mix must total 100"),
  cadenceGuidance: z.string().min(1).max(300), priorityRules: z.array(z.string().min(1).max(300)).min(1).max(8), ctaGuidance: z.array(z.string().min(1).max(300)).min(1).max(8),
  kpis: z.array(z.object({ name: z.string().min(1).max(200), target: z.string().min(1).max(200), measurement: z.string().min(1).max(300), evidenceRefs }).strict()).min(1).max(8),
  successCriteria: z.array(z.string().min(1).max(300)).min(1).max(8), constraints: z.array(z.string().min(1).max(300)).max(12), exclusions: z.array(z.string().min(1).max(300)).max(12), brandSafety: z.array(z.string().min(1).max(300)).max(12),
  briefs: z.array(z.object({ id: z.string().min(1).max(100), title: z.string().min(1).max(300), objective: z.string().min(1).max(600), audienceId: z.string().min(1).max(100), funnelStage, keyMessage: z.string().min(1).max(600), channelCandidates: z.array(z.string().min(1).max(100)).min(1).max(8), formatCandidates: z.array(z.string().min(1).max(100)).min(1).max(8), ctaIntent: z.string().min(1).max(300), intendedConversion: z.string().min(1).max(300), kpi: z.string().min(1).max(200), priority: z.number().int().min(1).max(5), dependencies: z.array(z.string().min(1).max(300)).max(8), constraints: z.array(z.string().min(1).max(300)).max(12), evidenceRefs }).strict()).min(1).max(10),
  assumptions: z.array(z.object({ text: z.string().min(1).max(500), evidenceRefs, confidence: z.enum(["low", "medium", "high"]) }).strict()).max(8),
  confidence: z.enum(["low", "medium", "high"]),
}).strict();

const utcTimestampSchema = z.string().datetime({ offset: true }).refine(
  (value) => /(?:Z|[+-]00:00)$/.test(value),
  "timestamp must be UTC",
);

const instant = (value: string) => Date.parse(value);

const ianaTimezoneSchema = z.string().min(1).max(100).superRefine((value, ctx) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
  } catch {
    ctx.addIssue({ code: "custom", message: "timezone must be a valid IANA timezone" });
  }
});

const strategyApprovalRecordSchema = z.object({
  decision: z.literal("approved"),
  payloadDigest: z.string().regex(/^[0-9a-f]{64}$/),
  revision: z.number().int().min(1).max(2),
  actorSubjectId: z.string().min(1).max(200),
  decidedAt: utcTimestampSchema,
  expiresAt: utcTimestampSchema,
  feedback: z.string().max(2000).optional(),
}).strict();

const channelCapabilitySchema = z.object({
  channel: z.string().min(1).max(100),
  formats: z.array(z.string().min(1).max(100)).min(1).max(8),
}).strict();

const editorialCommitmentSchema = z.object({
  id: z.string().min(1).max(100),
  channel: z.string().min(1).max(100),
  publicationWindowStartAt: utcTimestampSchema,
  publicationWindowEndAt: utcTimestampSchema,
}).strict().refine(
  (commitment) => instant(commitment.publicationWindowStartAt) < instant(commitment.publicationWindowEndAt),
  "publication window must increase",
);

const productionCapacitySchema = z.object({
  maxItems: z.number().int().min(1).max(48),
  maxItemsPerWeek: z.number().int().min(1).max(12),
}).strict();

const cadenceConstraintsSchema = z.object({
  minimumHoursBetweenItems: z.number().int().min(0).max(168),
  maxItemsPerChannelPerWeek: z.number().int().min(1).max(12),
}).strict();

const postingWindowObservationSchema = z.object({
  id: z.string().min(1).max(100),
  channel: z.string().min(1).max(100),
  format: z.string().min(1).max(100),
  observedAt: utcTimestampSchema,
  evidenceRefs,
}).strict();

export const editorialPlanningSnapshotSchema = z.object({
  snapshotId: z.string().min(1).max(100), asOf: utcTimestampSchema,
  horizonStartAt: utcTimestampSchema, horizonEndAt: utcTimestampSchema,
  timezone: ianaTimezoneSchema,
  channelCapabilities: z.array(channelCapabilitySchema).min(1).max(8),
  existingCommitments: z.array(editorialCommitmentSchema).max(48),
  productionCapacity: productionCapacitySchema,
  cadenceConstraints: cadenceConstraintsSchema,
  postingWindowObservations: z.array(postingWindowObservationSchema).max(24),
  assetReadiness: z.array(z.object({
    id: z.string().min(1).max(100), briefId: z.string().min(1).max(100),
    assetType: z.string().min(1).max(100), status: z.enum(["ready", "missing", "blocked"]),
    evidenceRefs,
  }).strict()).max(48),
  blockedDependencies: z.array(z.object({
    id: z.string().min(1).max(100), briefId: z.string().min(1).max(100),
    reason: z.string().min(1).max(300), evidenceRefs,
  }).strict()).max(48),
  calendarProjection: z.array(z.object({
    id: z.string().min(1).max(100), contentItemId: z.string().min(1).max(100),
    state: z.enum(["not_projected", "synced", "update_required", "removed", "failed"]),
    externalEventId: z.string().min(1).max(300).optional(), evidenceRefs,
  }).strict()).max(48),
  provenanceIds: z.array(z.string().min(1).max(100)).min(1).max(100),
}).strict().refine(
  (snapshot) => instant(snapshot.horizonStartAt) < instant(snapshot.horizonEndAt),
  "editorial horizon must increase",
);

export const editorialPlannerInputSchema = z.object({
  strategy: contentStrategySchema,
  strategyDigest: z.string().regex(/^[0-9a-f]{64}$/),
  strategyVersion: z.number().int().min(1).max(2),
  strategyApproval: strategyApprovalRecordSchema,
  analysis: sourceAnalysisSchema,
  planningSnapshot: editorialPlanningSnapshotSchema,
  planningSnapshotDigest: z.string().regex(/^[0-9a-f]{64}$/),
  revision: z.number().int().min(1).max(2),
  replanningFeedback: z.string().max(2000).optional(),
}).strict();

export const editorialPlanItemSchema = z.object({
  id: z.string().min(1).max(100), briefId: z.string().min(1).max(100),
  campaignTheme: z.string().min(1).max(200), contentPillar: z.string().min(1).max(200), objective: z.string().min(1).max(600),
  audienceId: z.string().min(1).max(100), funnelStage, intendedConversion: z.string().min(1).max(300), ctaIntent: z.string().min(1).max(300), kpi: z.string().min(1).max(200),
  channel: z.string().min(1).max(100), format: z.string().min(1).max(100), evidenceRefs,
  publicationWindowStartAt: utcTimestampSchema, publicationWindowEndAt: utcTimestampSchema, productionDeadlineAt: utcTimestampSchema,
  priority: z.number().int().min(1).max(5), selectionScore: z.number().min(0).max(1), dependencies: z.array(z.string().min(1).max(100)).max(8).default([]),
  productionStatus: z.literal("planned"), constraints: z.array(z.string().min(1).max(300)).max(12).default([]), requiredAssets: z.array(z.string().min(1).max(300)).max(12).default([]),
  planningRationale: z.string().min(1).max(600), selectionRationale: z.string().min(1).max(600), confidence: z.enum(["low", "medium", "high"]),
}).strict().refine(
  (item) => instant(item.publicationWindowStartAt) < instant(item.publicationWindowEndAt),
  "publication window must increase",
).refine(
  (item) => instant(item.productionDeadlineAt) <= instant(item.publicationWindowStartAt),
  "production deadline must be before the publication window",
);

export const editorialPlanSchema = z.object({
  planId: z.string().min(1).max(100), version: z.number().int().min(1).max(2), approvedStrategyDigest: z.string().regex(/^[0-9a-f]{64}$/),
  planningSnapshotId: z.string().min(1).max(100), planningSnapshotDigest: z.string().regex(/^[0-9a-f]{64}$/),
  horizonStartAt: utcTimestampSchema, horizonEndAt: utcTimestampSchema, timezone: ianaTimezoneSchema,
  summary: z.string().min(1).max(1000), sequencingRationale: z.string().min(1).max(1000), cadenceRationale: z.string().min(1).max(1000),
  assumptions: z.array(z.string().min(1).max(500)).max(12).default([]), confidence: z.enum(["low", "medium", "high"]),
  items: z.array(editorialPlanItemSchema).min(1).max(48), selectedNextItemId: z.string().min(1).max(100),
}).strict().refine(
  (plan) => instant(plan.horizonStartAt) < instant(plan.horizonEndAt),
  "editorial horizon must increase",
).refine(
  (plan) => plan.items.filter((item) => item.id === plan.selectedNextItemId).length === 1,
  "selectedNextItemId must identify exactly one plan item",
);

const strategySearchEvidenceSchema = z.object({
  evidenceId: z.string().regex(/^search-[A-Za-z0-9][A-Za-z0-9._:-]{0,92}$/),
  supportedText: z.string().min(1).max(1000), title: z.string().min(1).max(300),
  url: z.string().url().refine((value) => value.startsWith("https://") || value.startsWith("http://")),
}).strict();

export const strategySubmissionSchema = z.object({
  jobId: z.string().min(1), stage: z.literal("strategize"), revision: z.number().int().min(1).max(2),
  strategy: contentStrategySchema, modelUsed: z.string().min(1),
  searchEvidence: z.array(strategySearchEvidenceSchema).max(8),
  searchProvenance: searchProvenanceSchema.nullable(),
}).strict();

export const editorialPlanSubmissionSchema = z.object({
  jobId: z.string().min(1), stage: z.literal("plan"), revision: z.number().int().min(1).max(2),
  plan: editorialPlanSchema, modelUsed: z.string().min(1),
}).strict();

export const strategyInvocationContextSchema = z.object({
  jobId: z.string().min(1), stage: z.literal("strategize"), revision: z.number().int().min(1).max(2),
  sourceIds: z.array(z.string().min(1).max(100)).min(1).max(MAX_STRATEGY_SOURCE_IDS),
  operatorContextIds: z.array(z.string().min(1).max(100)).length(2),
  performance: z.array(z.object({ id: z.string().min(1).max(100), firestoreEvidenceRef: z.string().min(1).max(500) }).strict()).max(12),
  memoryFacts: z.array(z.object({ id: z.string().min(1).max(100), firestoreEvidenceRef: z.string().min(1).max(500) }).strict()).max(5),
  audienceIds: z.array(z.string().min(1).max(100)).min(1).max(6),
  requestedChannels: z.array(z.string().min(1).max(100)).min(1).max(8),
  supportedChannels: z.array(z.string().min(1).max(100)).min(1).max(8),
  horizonWeeks: z.number().int().min(1).max(12),
  researchRequest: strategyResearchRequestSchema.nullable(),
  searchEvidence: z.array(strategySearchEvidenceSchema).max(8),
}).strict();

export const receiptSubmissionSchema = z.object({
  commandId: z.string().min(1).optional(),
  jobId: z.string().min(1),
  actionId: z.string().min(1),
  actionType: z.enum([
    "export_content_artifact",
    "publish_x_post",
    "publish_x_thread",
    "publish_linkedin_post",
    "generate_image",
    "render_clip",
    "render_reel",
  ]),
  idempotencyKey: z.string().min(16),
  operationId: z.string().min(1).max(240),
  traceId: z.string().regex(/^[a-f0-9]{32}$/),
  claimToken: z.string().min(1).max(240),
  outcome: z.enum(["applied", "already_applied", "rejected", "failed"]),
  artifact: evidenceRefSchema.nullable().optional(),
  detail: z.record(z.string(), z.unknown()).default({}),
});

export const effectClaimSubmissionSchema = z.object({
  commandId: z.string().min(1).optional(),
  jobId: z.string().min(1),
  actionId: z.string().min(1),
  actionType: z.enum([
    "export_content_artifact", "publish_x_post", "publish_x_thread", "publish_linkedin_post", "generate_image",
    "render_clip", "render_reel",
  ]),
  idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/),
  operationId: z.string().min(1).max(240),
  traceId: z.string().regex(/^[a-f0-9]{32}$/).refine((value) => value !== "0".repeat(32)),
  claimToken: z.string().min(1).max(240),
});

export const verificationSubmissionSchema = z.object({
  jobId: z.string().min(1),
  results: z.array(
    z.object({
      target: z.string().min(1),
      actionId: z.string().min(1),
      receiptId: z.string().min(1),
      operationId: z.string().min(1).max(240),
      traceId: z.string().regex(/^[a-f0-9]{32}$/).refine((value) => value !== "0".repeat(32)),
      verified: z.boolean(),
      method: z.enum(["artifact_digest_reread", "official_api_readback"]),
      evidence: evidenceRefSchema,
      note: z.string().optional(),
    }),
  ),
});

export const proposalSubmissionSchema = z.object({
  proposals: z
    .array(
      z.object({
        id: z.string().min(6).max(40),
        source: z.enum(["trend_scan", "engagement_watch", "calendar_gap", "recycle"]),
        topic: z.string().min(4).max(300),
        angle: z.string().max(300).default(""),
        reason: z.string().max(600).default(""),
        sources: z.array(z.string().url()).max(5).default([]),
        suggestedPost: z.string().max(280).default(""),
      }),
    )
    .min(1)
    .max(10),
});

export const proposalDecisionSchema = z.object({
  id: z.string().min(1),
  decision: z.enum(["approved", "rejected"]),
});

export const engagementRecordSchema = z.object({
  actionId: z.string().min(1),
  postId: z.string().min(1),
  url: z.string().optional(),
  likes: z.number().int().nonnegative(),
  replies: z.number().int().nonnegative(),
  reposts: z.number().int().nonnegative(),
  quotes: z.number().int().nonnegative(),
  impressions: z.number().int().nonnegative().optional(),
});

export const engagementSubmissionSchema = z.object({
  jobId: z.string().min(1),
  stage: z.literal("learn"),
  engagement: z.array(engagementRecordSchema).max(20).default([]),
  learnings: z.object({
    summary: z.string().min(1),
    notes: z.array(z.string()).max(10).default([]),
  }),
});

export const failureSubmissionSchema = z.object({
  jobId: z.string().min(1),
  stage: z.string().min(1),
  category: z.enum([
    "validation", "authorization", "policy", "budget",
    "provider_transient", "provider_permanent", "dependency", "protocol",
  ]),
  code: z.string().regex(/^[a-z0-9_]+$/).max(80),
  publicMessage: z.string().min(1).max(240),
  retryable: z.boolean(),
  operationId: z.string().min(1).max(240),
  traceId: z.string().regex(/^[a-f0-9]{32}$/),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().min(1).max(10),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).superRefine((details, ctx) => {
    for (const key of Object.keys(details)) {
      if (/(body|content|cookie|prompt|response|secret|text|token|transcript)/i.test(key)) {
        ctx.addIssue({ code: "custom", path: [key], message: "content-bearing failure detail is forbidden" });
      }
    }
  }),
}).strict();

export const agentActivitySchema = z.object({
  kind: z.enum(["handoff", "tool_call", "retry", "failure"]),
  status: z.enum(["succeeded", "retrying", "failed"]),
  role: z.enum([
    "harmonia_intent_router", "nimi_analyst", "ryan_strategist", "temi_editorial_planner",
    "noni_copywriter", "dara_editor", "noni_artifact_producer", "dara_artifact_editor",
    "maya_trend_researcher", "maya_presenter", "nova_liaison", "coordinator_system",
  ]),
  fromRole: z.string().min(1).max(80).optional(),
  toRole: z.string().min(1).max(80).optional(),
  code: z.string().regex(/^[a-z0-9_]+$/).max(80).optional(),
  category: z.enum([
    "validation", "authorization", "policy", "budget", "provider_transient",
    "provider_permanent", "dependency", "protocol", "not_found",
  ]).optional(),
  publicMessage: z.string().min(1).max(240),
  path: z.string().min(1).max(240).optional(),
  retryable: z.boolean().optional(),
  attempt: z.number().int().nonnegative().optional(),
  maxAttempts: z.number().int().positive().max(10).optional(),
  skillName: z.string().min(1).max(100).optional(),
  toolName: z.string().min(1).max(100).optional(),
  durationMs: z.number().int().nonnegative().optional(),
}).strict().superRefine((activity, ctx) => {
  if (activity.kind === "handoff" && (!activity.fromRole || !activity.toRole)) {
    ctx.addIssue({ code: "custom", message: "handoff requires fromRole and toRole" });
  }
  if ((activity.kind === "failure" || activity.kind === "retry") && (!activity.code || !activity.category)) {
    ctx.addIssue({ code: "custom", message: "failure activity requires code and category" });
  }
  if (activity.kind === "tool_call" && !activity.toolName) {
    ctx.addIssue({ code: "custom", message: "tool activity requires toolName" });
  }
});

export type AgentActivity = z.infer<typeof agentActivitySchema>;

export type FailureSubmission = z.infer<typeof failureSubmissionSchema>;
