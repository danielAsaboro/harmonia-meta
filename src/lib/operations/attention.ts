import { z } from "zod";

export const attentionKindSchema = z.enum([
  "approval",
  "strategy_decision",
  "uncertain_effect",
  "credential_required",
  "budget_required",
  "failed_stage",
  "missing_asset",
  "policy_block",
]);
export type AttentionKind = z.infer<typeof attentionKindSchema>;

export interface AttentionSource {
  kind: AttentionKind;
  sourceId: string;
  workspaceId: string;
  brandId: string;
  jobId?: string;
  state: "open" | "acknowledged" | "resolved";
  title: string;
  reason: string;
  createdAt: string;
  dueAt?: string;
}

export interface AttentionItem extends AttentionSource {
  id: string;
  priority: number;
  actionHref: string;
}

export const attentionItemSchema = z.object({
  id: z.string().min(1).max(700),
  kind: attentionKindSchema,
  sourceId: z.string().min(1).max(300),
  workspaceId: z.string().min(1).max(128),
  brandId: z.string().min(1).max(128),
  jobId: z.string().min(1).max(300).optional(),
  state: z.enum(["open", "acknowledged", "resolved"]),
  title: z.string().min(1).max(500),
  reason: z.string().min(1).max(2_000),
  createdAt: z.string().datetime({ offset: true }),
  dueAt: z.string().datetime({ offset: true }).optional(),
  priority: z.number().int().min(0).max(100),
  actionHref: z.string().startsWith("/dashboard/"),
}).strict();

const priority: Record<AttentionKind, number> = {
  uncertain_effect: 100,
  policy_block: 90,
  credential_required: 80,
  budget_required: 70,
  approval: 60,
  strategy_decision: 55,
  failed_stage: 50,
  missing_asset: 40,
};

function jobHref(source: AttentionSource, focus: string): string {
  if (!source.jobId) throw new Error(`${source.kind} attention requires a job id`);
  return `/dashboard/monitoring?tab=jobs&job=${encodeURIComponent(source.jobId)}&focus=${focus}&source=${encodeURIComponent(source.sourceId)}`;
}

function actionHref(source: AttentionSource): string {
  switch (source.kind) {
    case "approval": return jobHref(source, "approval");
    case "strategy_decision": return jobHref(source, "strategy");
    case "failed_stage": return source.jobId ? jobHref(source, "failure") : `/dashboard/monitoring?tab=autonomy&focus=${encodeURIComponent(source.sourceId)}`;
    case "missing_asset": return jobHref(source, "asset");
    case "policy_block": return source.jobId ? jobHref(source, "policy") : `/dashboard/monitoring?tab=autonomy&focus=${encodeURIComponent(source.sourceId)}`;
    case "budget_required": return source.jobId ? jobHref(source, "budget") : `/dashboard/settings?focus=budget&source=${encodeURIComponent(source.sourceId)}`;
    case "uncertain_effect": return `/dashboard/monitoring?tab=agents&focus=${encodeURIComponent(source.sourceId)}`;
    case "credential_required": return `/dashboard/settings?focus=connections&source=${encodeURIComponent(source.sourceId)}`;
  }
}

export function projectAttentionItems(sources: AttentionSource[]): AttentionItem[] {
  const scope = sources[0] ? `${sources[0].workspaceId}:${sources[0].brandId}` : null;
  const items = new Map<string, AttentionItem>();
  for (const source of sources) {
    if (`${source.workspaceId}:${source.brandId}` !== scope) {
      throw new Error("attention sources must share the same tenant scope");
    }
    if (source.state === "resolved") continue;
    if (!source.sourceId || !source.title || !source.reason || !Number.isFinite(Date.parse(source.createdAt))) {
      throw new Error("attention source is incomplete");
    }
    const id = `attention:${source.kind}:${source.sourceId}`;
    if (!items.has(id)) {
      items.set(id, attentionItemSchema.parse({ ...source, id, priority: priority[source.kind], actionHref: actionHref(source) }));
    }
  }
  return [...items.values()].sort((left, right) =>
    right.priority - left.priority
      || Date.parse(left.createdAt) - Date.parse(right.createdAt)
      || left.id.localeCompare(right.id));
}
