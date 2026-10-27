import { z } from "zod";

export const HARMONIA_CATALOG_ID = "https://harmonia.app/a2ui/catalogs/chat/v1";

const id = z.string().min(1).max(200);
const status = z.enum(["pending", "active", "complete", "failed"]);
const httpUrl = z.string().url().refine((value) => {
  const protocol = new URL(value).protocol;
  return protocol === "https:" || protocol === "http:";
}, "only HTTP(S) URLs are allowed");
const authorizedPreviewUrl = z.string().refine(
  (value) => value.startsWith("/api/chat/attachments/") || /^\/api\/jobs\/[^/]+\/assets\/[^/]+$/.test(value),
  "only authorized same-origin preview routes are allowed",
);

export const activitySchema = z.object({
  id,
  label: z.string().min(1).max(500),
  description: z.string().max(2_000).optional(),
  status,
  sourceIds: z.array(id).max(50).optional(),
}).strict();

const baseComponent = z.object({ id, component: z.string() });

const activityTraceSchema = baseComponent.extend({
  component: z.literal("ActivityTrace"),
  title: z.string().min(1).max(200),
  steps: z.array(activitySchema).max(100),
}).strict();

const reasoningSummarySchema = baseComponent.extend({
  component: z.literal("ReasoningSummary"),
  summary: z.string().min(1).max(4_000),
  sourceIds: z.array(id).max(50).optional(),
}).strict();

const attachmentCardSchema = baseComponent.extend({
  component: z.literal("AttachmentCard"),
  attachmentId: id,
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(120),
  sizeBytes: z.number().int().nonnegative(),
  state: z.enum(["uploading", "ready", "failed"]),
  previewUrl: authorizedPreviewUrl.optional(),
}).strict();

const inlineCitationSchema = baseComponent.extend({
  component: z.literal("InlineCitation"),
  title: z.string().min(1).max(500),
  url: httpUrl,
  sourceId: id.optional(),
  excerpt: z.string().max(1_000).optional(),
}).strict();

const planStepSchema = z.object({
  id,
  label: z.string().min(1).max(500),
  status,
}).strict();

const planViewSchema = baseComponent.extend({
  component: z.literal("PlanView"),
  title: z.string().min(1).max(200),
  steps: z.array(planStepSchema).max(100),
}).strict();

const queueItemSchema = z.object({
  id,
  label: z.string().min(1).max(500),
  status,
  jobId: id.optional(),
}).strict();

const queueViewSchema = baseComponent.extend({
  component: z.literal("QueueView"),
  title: z.string().min(1).max(200),
  items: z.array(queueItemSchema).max(100),
}).strict();

const toolActivitySchema = baseComponent.extend({
  component: z.literal("ToolActivity"),
  name: z.string().min(1).max(200),
  status,
  inputSummary: z.string().max(2_000).optional(),
  outputSummary: z.string().max(2_000).optional(),
  durationMs: z.number().int().nonnegative().optional(),
  traceId: id.optional(),
}).strict();

const taskViewSchema = baseComponent.extend({
  component: z.literal("TaskView"),
  title: z.string().min(1).max(500),
  owner: z.string().min(1).max(200).optional(),
  status,
  jobId: id.optional(),
  stage: z.string().min(1).max(100).optional(),
}).strict();

const contextUsageSchema = baseComponent.extend({
  component: z.literal("ContextUsage"),
  model: z.string().min(1).max(200),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  contextLimit: z.number().int().positive().optional(),
  cachedTokens: z.number().int().nonnegative().optional(),
  estimatedCostUsd: z.number().nonnegative().optional(),
}).strict();

const messageContentSchema = baseComponent.extend({
  component: z.literal("MessageContent"),
  text: z.string().max(20_000),
  citationIds: z.array(id).max(100).optional(),
  attachmentIds: z.array(id).max(100).optional(),
}).strict();

const confirmationFields = {
  id,
  operationId: id.optional(),
  jobId: id.optional(),
  actionId: id.optional(),
  title: z.string().min(1).max(500),
  description: z.string().max(2_000).optional(),
  risk: z.enum(["low", "material", "high"]),
  state: z.enum(["pending", "approved", "rejected", "expired"]),
} as const;
const hasOneConfirmationTarget = (value: { operationId?: string; jobId?: string; actionId?: string }) =>
  Boolean(value.operationId) !== Boolean(value.jobId && value.actionId);

const confirmationSchema = z.object({
  ...confirmationFields,
  component: z.literal("Confirmation"),
}).strict().refine(
  hasOneConfirmationTarget,
  "confirmation must reference either one operation or one job action",
);

const generatedNode = {
  children: z.array(id).max(30).default([]),
  emphasis: z.enum(["primary", "secondary", "compact"]).default("primary"),
  agentFraming: z.boolean().default(false),
  tone: z.enum(["paper", "ink", "acid", "blue", "coral", "violet"]).default("paper"),
  role: z.enum(["hero", "feature", "support", "strip", "inline"]).default("support"),
  density: z.enum(["airy", "balanced", "compact"]).default("balanced"),
  motion: z.enum(["none", "reveal", "pulse", "trace"]).default("none"),
  surfaceRhythm: z.enum(["editorial", "operational", "cinematic", "evidence"]).default("editorial"),
  surfaceComposition: z.enum(["stack", "split", "mosaic", "rail"]).default("stack"),
  surfaceEnergy: z.enum(["quiet", "active", "resolved"]).default("quiet"),
  revision: z.number().int().positive().default(1),
} as const;

const campaignBriefSchema = baseComponent.extend({
  component: z.literal("CampaignBrief"),
  jobId: id,
  title: z.string().min(1).max(200),
  brief: z.string().max(4_000),
  sourceKind: z.enum(["video", "audio", "document", "web", "text", "mixed"]),
  platforms: z.array(z.string().min(1).max(50)).max(10),
  angles: z.array(z.object({
    id,
    angleType: z.enum(["source_insight", "trend", "meme", "performance_learning", "memory_learning"]),
    evidenceKind: z.enum(["source", "public_context", "performance", "memory"]),
    title: z.string().min(1).max(300),
    rationale: z.string().max(2_000),
  }).strict()).max(20),
  ...generatedNode,
}).strict();

const jobProgressSchema = baseComponent.extend({
  component: z.literal("JobProgress"),
  jobId: id,
  title: z.string().min(1).max(200),
  stage: z.string().min(1).max(100),
  status: z.string().min(1).max(100),
  stages: z.array(planStepSchema).max(20),
  ...generatedNode,
}).strict();

const momentExplorerSchema = baseComponent.extend({
  component: z.literal("MomentExplorer"),
  jobId: id,
  title: z.string().min(1).max(200),
  source: z.object({
    id,
    label: z.string().min(1).max(300),
    kind: z.enum(["video", "audio", "media"]),
    previewUrl: authorizedPreviewUrl.optional(),
    externalUrl: httpUrl.optional(),
    durationSec: z.number().nonnegative().optional(),
  }).strict().optional(),
  moments: z.array(z.object({
    id,
    title: z.string().min(1).max(300),
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
    hook: z.string().max(2_000),
    quote: z.string().max(4_000),
    visualHook: z.string().max(2_000).optional(),
    cropSuitability: z.enum(["poor", "fair", "good", "excellent"]).optional(),
    selected: z.boolean(),
  }).strict()).max(20),
  transcript: z.array(z.object({
    id,
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
    text: z.string().max(5_000),
  }).strict()).max(200),
  ...generatedNode,
}).strict();

const hydratedDraftSchema = z.object({
  id,
  platform: z.string().min(1).max(50),
  text: z.string().max(20_000),
  valid: z.boolean(),
  validationNote: z.string().max(2_000).optional(),
  momentId: id.optional(),
  angleId: id.optional(),
  selected: z.boolean(),
  sourceCount: z.number().int().nonnegative(),
}).strict();

const draftComparisonSchema = baseComponent.extend({
  component: z.literal("DraftComparison"),
  jobId: id,
  title: z.string().min(1).max(200),
  drafts: z.array(hydratedDraftSchema).min(1).max(20),
  ...generatedNode,
}).strict();

const platformPreviewSchema = baseComponent.extend({
  component: z.literal("PlatformPreview"),
  jobId: id,
  title: z.string().min(1).max(200),
  draft: hydratedDraftSchema,
  assets: z.array(z.object({
    actionId: id,
    mime: z.string().min(1).max(120),
    previewUrl: authorizedPreviewUrl,
  }).strict()).max(20),
  ...generatedNode,
}).strict();

const sourceEvidenceSchema = baseComponent.extend({
  component: z.literal("SourceEvidence"),
  jobId: id,
  title: z.string().min(1).max(200),
  sources: z.array(z.object({
    id,
    kind: z.enum(["video", "audio", "document", "web", "text", "segment", "moment", "angle", "receipt"]),
    label: z.string().min(1).max(300),
    url: httpUrl.optional(),
    excerpt: z.string().max(4_000).optional(),
  }).strict()).min(1).max(100),
  links: z.array(z.object({
    fromId: id,
    toId: id,
    label: z.string().min(1).max(200),
  }).strict()).max(200),
  ...generatedNode,
}).strict();

const approvalReviewSchema = baseComponent.extend({
  component: z.literal("ApprovalReview"),
  jobId: id,
  actionId: id,
  actionType: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  description: z.string().max(2_000),
  risk: z.enum(["low", "medium", "high"]),
  requiresApproval: z.boolean(),
  approvalState: z.enum(["not_required", "pending", "approved", "rejected"]),
  actionState: z.enum(["planned", "executed", "skipped", "failed"]),
  destination: z.string().max(200).optional(),
  previewText: z.string().max(20_000).optional(),
  ...generatedNode,
}).strict();

const verificationReceiptSchema = baseComponent.extend({
  component: z.literal("VerificationReceipt"),
  jobId: id,
  receiptId: id,
  actionId: id,
  actionType: z.string().min(1).max(100),
  title: z.string().min(1).max(500),
  performedAt: z.string().datetime(),
  outcome: z.enum(["applied", "already_applied", "rejected", "failed"]),
  verified: z.boolean(),
  verificationMethod: z.string().max(500).optional(),
  verificationNote: z.string().max(2_000).optional(),
  artifact: z.object({
    kind: z.string().min(1).max(100),
    url: httpUrl.optional(),
    digest: z.string().max(500).nullable().optional(),
  }).strict().optional(),
  ...generatedNode,
}).strict();

const surfaceStateBase = {
  title: z.string().min(1).max(200),
  message: z.string().max(2_000),
  ...generatedNode,
} as const;
const surfaceLoadingSchema = baseComponent.extend({ component: z.literal("SurfaceLoading"), ...surfaceStateBase }).strict();
const surfaceEmptySchema = baseComponent.extend({ component: z.literal("SurfaceEmpty"), ...surfaceStateBase }).strict();
const surfaceUnresolvedSchema = baseComponent.extend({
  component: z.literal("SurfaceUnresolved"),
  ...surfaceStateBase,
  missingRefs: z.array(id).min(1).max(100),
}).strict();
const surfaceFailureSchema = baseComponent.extend({
  component: z.literal("SurfaceFailure"),
  ...surfaceStateBase,
  retryable: z.boolean(),
}).strict();

export const catalogComponentSchema = z.discriminatedUnion("component", [
  activityTraceSchema,
  reasoningSummarySchema,
  attachmentCardSchema,
  inlineCitationSchema,
  planViewSchema,
  queueViewSchema,
  toolActivitySchema,
  taskViewSchema,
  contextUsageSchema,
  messageContentSchema,
  confirmationSchema,
  campaignBriefSchema,
  jobProgressSchema,
  momentExplorerSchema,
  draftComparisonSchema,
  platformPreviewSchema,
  sourceEvidenceSchema,
  approvalReviewSchema,
  verificationReceiptSchema,
  surfaceLoadingSchema,
  surfaceEmptySchema,
  surfaceUnresolvedSchema,
  surfaceFailureSchema,
]);

export type HarmoniaCatalogComponent = z.infer<typeof catalogComponentSchema>;

export function parseCatalogComponent(value: unknown): HarmoniaCatalogComponent {
  return catalogComponentSchema.parse(value);
}

const eventBase = z.object({
  runId: id,
  sequence: z.number().int().nonnegative(),
});

const streamEventSchema = z.discriminatedUnion("type", [
  eventBase.extend({ type: z.literal("run_started"), startedAt: z.string().datetime() }).strict(),
  eventBase.extend({ type: z.literal("text_delta"), delta: z.string().max(20_000) }).strict(),
  eventBase.extend({ type: z.literal("activity"), activity: activitySchema }).strict(),
  eventBase.extend({
    type: z.literal("tool_activity"),
    tool: toolActivitySchema.omit({ component: true, id: true }),
  }).strict(),
  eventBase.extend({
    type: z.literal("a2ui_operation"),
    operation: z.record(z.string(), z.unknown()),
  }).strict(),
  eventBase.extend({
    type: z.literal("confirmation_requested"),
    confirmation: z.object(confirmationFields).strict().refine(hasOneConfirmationTarget),
  }).strict(),
  eventBase.extend({
    type: z.literal("job_updated"),
    jobId: id,
    stage: z.string().min(1).max(100),
    status: z.string().min(1).max(100),
  }).strict(),
  eventBase.extend({
    type: z.literal("run_completed"),
    completedAt: z.string().datetime(),
    reply: z.string().max(20_000),
  }).strict(),
  eventBase.extend({
    type: z.literal("run_failed"),
    failedAt: z.string().datetime(),
    error: z.string().min(1).max(4_000),
    permanent: z.boolean(),
  }).strict(),
]);

export type ChatStreamEvent = z.infer<typeof streamEventSchema>;

export function parseChatStreamEvent(value: unknown): ChatStreamEvent {
  return streamEventSchema.parse(value);
}
