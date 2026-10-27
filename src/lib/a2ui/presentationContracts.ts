import { z } from "zod";

const id = z.string().min(1).max(200);
const boundedList = <T extends z.ZodTypeAny>(schema: T, max: number) => z.array(schema).max(max);

const jobSummarySchema = z.object({
  id,
  stage: z.string().min(1).max(100),
  status: z.string().min(1).max(100),
  title: z.string().max(300).optional(),
  sourceKind: z.enum(["video", "audio", "document", "web", "text", "mixed"]),
}).strict();

const draftSummarySchema = z.object({
  id,
  platform: z.string().min(1).max(50),
  valid: z.boolean(),
  momentId: id.optional(),
  angleId: id.optional(),
}).strict();

const momentSummarySchema = z.object({
  id,
  title: z.string().min(1).max(300),
  startSec: z.number().nonnegative(),
  endSec: z.number().nonnegative(),
}).strict().refine((value) => value.endSec >= value.startSec, {
  message: "moment endSec must not precede startSec",
});

const sourceSummarySchema = z.object({
  id,
  kind: z.enum(["video", "audio", "document", "web", "text", "segment"]),
  label: z.string().min(1).max(300),
}).strict();

const assetSummarySchema = z.object({
  actionId: id,
  kind: z.enum(["image", "video", "audio", "document", "other"]),
  mime: z.string().min(1).max(120),
}).strict();

const actionSummarySchema = z.object({
  id,
  type: z.string().min(1).max(100),
  pending: z.boolean(),
}).strict();

const receiptSummarySchema = z.object({
  id,
  actionId: id,
  outcome: z.enum(["applied", "already_applied", "rejected", "failed"]),
  verified: z.boolean(),
}).strict();

export const uiContextSchema = z.object({
  runId: id,
  operatorRequest: z.string().min(1).max(2_000),
  intent: z.string().min(1).max(100),
  job: jobSummarySchema.nullable().optional(),
  drafts: boundedList(draftSummarySchema, 20).default([]),
  moments: boundedList(momentSummarySchema, 20).default([]),
  sources: boundedList(sourceSummarySchema, 50).default([]),
  assets: boundedList(assetSummarySchema, 20).default([]),
  actions: boundedList(actionSummarySchema, 20).default([]),
  receipts: boundedList(receiptSummarySchema, 20).default([]),
}).strict().superRefine((context, refinement) => {
  const groups = [
    ["draft", context.drafts.map((item) => item.id)],
    ["moment", context.moments.map((item) => item.id)],
    ["source", context.sources.map((item) => item.id)],
    ["asset action", context.assets.map((item) => item.actionId)],
    ["action", context.actions.map((item) => item.id)],
    ["receipt", context.receipts.map((item) => item.id)],
  ] as const;
  for (const [label, ids] of groups) if (new Set(ids).size !== ids.length) {
    refinement.addIssue({ code: "custom", message: `${label} ids must be unique` });
  }
});

export const surfaceSlots = ["canvas", "conversation", "approval"] as const;
export const surfaceComponentNames = [
  "CampaignBrief",
  "JobProgress",
  "MomentExplorer",
  "DraftComparison",
  "PlatformPreview",
  "SourceEvidence",
  "ApprovalReview",
  "VerificationReceipt",
] as const;

const entityRefsSchema = z.object({
  jobId: id,
  draftIds: boundedList(id, 20).default([]),
  momentIds: boundedList(id, 20).default([]),
  sourceIds: boundedList(id, 50).default([]),
  assetActionIds: boundedList(id, 20).default([]),
  actionIds: boundedList(id, 20).default([]),
  receiptIds: boundedList(id, 20).default([]),
}).strict().superRefine((refs, context) => {
  for (const [field, values] of Object.entries(refs)) {
    if (Array.isArray(values) && new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: `${field} must contain unique references` });
    }
  }
});

export const surfaceArtDirectionSchema = z.object({
  rhythm: z.enum(["editorial", "operational", "cinematic", "evidence"]).default("editorial"),
  composition: z.enum(["stack", "split", "mosaic", "rail"]).default("stack"),
  energy: z.enum(["quiet", "active", "resolved"]).default("quiet"),
}).strict();

export const nodeArtDirectionSchema = z.object({
  tone: z.enum(["paper", "ink", "acid", "blue", "coral", "violet"]).default("paper"),
  role: z.enum(["hero", "feature", "support", "strip", "inline"]).default("support"),
  density: z.enum(["airy", "balanced", "compact"]).default("balanced"),
  motion: z.enum(["none", "reveal", "pulse", "trace"]).default("none"),
}).strict();

const surfacePlanNodeSchema = z.object({
  id,
  component: z.enum(surfaceComponentNames),
  refs: entityRefsSchema,
  title: z.string().max(160).optional(),
  emphasis: z.enum(["primary", "secondary", "compact"]).default("primary"),
  artDirection: nodeArtDirectionSchema.default({
    tone: "paper",
    role: "support",
    density: "balanced",
    motion: "none",
  }),
  children: boundedList(id, 30).default([]),
}).strict();

const plannedSurfaceSchema = z.object({
  slot: z.enum(surfaceSlots),
  revision: z.number().int().positive(),
  rootId: id,
  artDirection: surfaceArtDirectionSchema.default({
    rhythm: "editorial",
    composition: "stack",
    energy: "quiet",
  }),
  nodes: z.array(surfacePlanNodeSchema).min(1).max(40),
}).strict().superRefine((surface, context) => {
  const ids = surface.nodes.map((node) => node.id);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: "custom", message: "surface graph node ids must be unique" });
  }
  if (!ids.includes(surface.rootId)) {
    context.addIssue({ code: "custom", message: "surface graph must include rootId" });
  }
  for (const node of surface.nodes) {
    for (const child of node.children) {
      if (!ids.includes(child)) {
        context.addIssue({ code: "custom", message: `surface graph contains dangling child ${child}` });
      }
    }
  }
  const nodes = new Map(surface.nodes.map((node) => [node.id, node]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let cyclic = false;
  const visit = (nodeId: string) => {
    if (visiting.has(nodeId)) {
      cyclic = true;
      return;
    }
    if (visited.has(nodeId)) return;
    const node = nodes.get(nodeId);
    if (!node) return;
    visiting.add(nodeId);
    for (const child of node.children) visit(child);
    visiting.delete(nodeId);
    visited.add(nodeId);
  };
  visit(surface.rootId);
  if (cyclic) {
    context.addIssue({ code: "custom", message: "surface graph must be acyclic" });
  }
  if (visited.size !== ids.length) {
    context.addIssue({ code: "custom", message: "surface graph contains nodes unreachable from rootId" });
  }
});

export const surfacePlanSchema = z.object({
  version: z.literal("harmonia.ui/v1"),
  surfaces: z.array(plannedSurfaceSchema).min(1).max(3),
}).strict().superRefine((plan, context) => {
  const slots = plan.surfaces.map((surface) => surface.slot);
  if (new Set(slots).size !== slots.length) {
    context.addIssue({ code: "custom", message: "surface plan slots must be unique" });
  }
});

export type UiContext = z.infer<typeof uiContextSchema>;
export type SurfacePlan = z.infer<typeof surfacePlanSchema>;
export type SurfaceSlot = (typeof surfaceSlots)[number];
export type SurfaceComponentName = (typeof surfaceComponentNames)[number];
export type SurfaceArtDirection = z.infer<typeof surfaceArtDirectionSchema>;
export type NodeArtDirection = z.infer<typeof nodeArtDirectionSchema>;

const authorityTitle = /\b(?:approved|rejected|published|verified|executed|scheduled|authorized)\b/i;
const refFields = ["draftIds", "momentIds", "sourceIds", "assetActionIds", "actionIds", "receiptIds"] as const;
const allowedRefs: Record<SurfaceComponentName, ReadonlySet<(typeof refFields)[number]>> = {
  CampaignBrief: new Set(), JobProgress: new Set(), MomentExplorer: new Set(["momentIds"]),
  DraftComparison: new Set(["draftIds"]), PlatformPreview: new Set(["draftIds", "assetActionIds"]),
  SourceEvidence: new Set(["sourceIds"]), ApprovalReview: new Set(["actionIds"]),
  VerificationReceipt: new Set(["receiptIds"]),
};

export function validateSurfacePlan(context: UiContext, plan: SurfacePlan): SurfacePlan {
  if (!context.job) throw new Error("Maya requires an active persisted job");
  const known = {
    draftIds: new Set(context.drafts.map((item) => item.id)),
    momentIds: new Set(context.moments.map((item) => item.id)),
    sourceIds: new Set(context.sources.map((item) => item.id)),
    assetActionIds: new Set(context.assets.map((item) => item.actionId)),
    actionIds: new Set(context.actions.map((item) => item.id)),
    receiptIds: new Set(context.receipts.map((item) => item.id)),
  };
  const labels = { draftIds: "draft", momentIds: "moment", sourceIds: "source", assetActionIds: "asset action", actionIds: "action", receiptIds: "receipt" };
  const pendingActions = new Set(context.actions.filter((item) => item.pending).map((item) => item.id));
  for (const surface of plan.surfaces) {
    if (surface.slot === "approval" && surface.nodes.filter((node) => node.component === "ApprovalReview").length !== 1) {
      throw new Error("Maya approval surface requires exactly one ApprovalReview");
    }
    for (const node of surface.nodes) {
      if (node.title && authorityTitle.test(node.title)) throw new Error("Maya title claims lifecycle authority");
      if (node.refs.jobId !== context.job.id) throw new Error("Maya node must reference the exact active job");
      for (const field of refFields) {
        const values = node.refs[field];
        if (values.length && !allowedRefs[node.component].has(field)) throw new Error(`Maya ${node.component} cannot use ${field}`);
        const unknown = values.filter((value) => !known[field].has(value));
        if (unknown.length) throw new Error(`Maya references unknown ${labels[field]} ids: ${unknown.join(", ")}`);
      }
      if (node.component === "MomentExplorer" && !node.refs.momentIds.length) throw new Error("Maya MomentExplorer requires momentIds");
      if (node.component === "DraftComparison" && !node.refs.draftIds.length) throw new Error("Maya DraftComparison requires draftIds");
      if (node.component === "PlatformPreview" && node.refs.draftIds.length !== 1) throw new Error("Maya PlatformPreview requires exactly one draftId");
      if (node.component === "SourceEvidence" && !node.refs.sourceIds.length) throw new Error("Maya SourceEvidence requires sourceIds");
      if (node.component === "ApprovalReview") {
        if (surface.slot !== "approval") throw new Error("Maya ApprovalReview requires the approval slot");
        if (node.refs.actionIds.length !== 1) throw new Error("Maya ApprovalReview requires exactly one actionId");
        if (!pendingActions.has(node.refs.actionIds[0])) throw new Error("Maya ApprovalReview requires a pending action");
      }
      if (node.component === "VerificationReceipt" && node.refs.receiptIds.length !== 1) throw new Error("Maya VerificationReceipt requires exactly one receiptId");
    }
  }
  return plan;
}
