import { createHash } from "node:crypto";
import type { EditorialPlan } from "./types";

function canonicalBytes(value: unknown): string {
  if (value === null) return "n;";
  if (typeof value === "boolean") return value ? "b1;" : "b0;";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("editorial plan digest requires finite numbers");
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(Object.is(value, -0) ? 0 : value);
    return `d${bytes.toString("hex")};`;
  }
  if (typeof value === "string") return `s${Buffer.byteLength(value, "utf8")}:${value}`;
  if (Array.isArray(value)) return `a${value.length}[${value.map(canonicalBytes).join("")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
    return `o${entries.length}{${entries.map(([key, entry]) => canonicalBytes(key) + canonicalBytes(entry)).join("")}}`;
  }
  throw new Error("editorial plan digest contains an unsupported value");
}

export function editorialPlanDigest(plan: unknown): string {
  return createHash("sha256").update(canonicalBytes(plan), "utf8").digest("hex");
}

export function editorialPlanningSnapshotDigest(snapshot: unknown): string {
  return createHash("sha256").update(canonicalBytes(snapshot), "utf8").digest("hex");
}

export function editorialPlanEvidenceLineage(plan: EditorialPlan): string[] {
  return [...new Set(plan.items.flatMap((item) => item.evidenceRefs))].sort();
}

export type ProductionAuthority = {
  editorialPlanId: string;
  editorialPlanDigest: string;
  editorialItemId: string;
  briefId: string;
};

export function editorialDraftCompletionPatch(
  editorialItemId: string,
  updatedAt: string,
  needsApproval: boolean,
) {
  const itemStatus = needsApproval ? "awaiting_approval" : "reviewed";
  return {
    [`editorialItemStates.${editorialItemId}`]: { status: itemStatus, updatedAt },
    ...(needsApproval ? { stage: "awaiting_approval", status: "waiting_for_approval" } : {}),
    updatedAt,
  };
}

export function isMatchingCompletedProduction(
  job: {
    stage: string; activeProductionLineage?: ProductionAuthority;
    editorialItemStates?: Record<string, { status: string; updatedAt: string }>;
  },
  authority: ProductionAuthority,
  needsApproval: boolean,
): boolean {
  if (!needsApproval || job.stage !== "awaiting_approval") return false;
  if (job.editorialItemStates?.[authority.editorialItemId]?.status !== "awaiting_approval") return false;
  const active = job.activeProductionLineage;
  return Boolean(active
    && active.editorialPlanId === authority.editorialPlanId
    && active.editorialPlanDigest === authority.editorialPlanDigest
    && active.editorialItemId === authority.editorialItemId
    && active.briefId === authority.briefId);
}

export function isMatchingActiveProduction(
  job: {
    stage: string; activeProductionLineage?: ProductionAuthority;
    editorialItemStates?: Record<string, { status: string; updatedAt: string }>;
  },
  authority: ProductionAuthority,
): boolean {
  if (job.stage !== "draft") return false;
  if (job.editorialItemStates?.[authority.editorialItemId]?.status !== "drafting") return false;
  const active = job.activeProductionLineage;
  return Boolean(active
    && active.editorialPlanId === authority.editorialPlanId
    && active.editorialPlanDigest === authority.editorialPlanDigest
    && active.editorialItemId === authority.editorialItemId
    && active.briefId === authority.briefId);
}

export function assertSelectedProductionAuthority(
  job: {
    stage: string; editorialPlan?: EditorialPlan; editorialPlanDigest?: string;
    selectedNextItemId?: string;
    strategyDigest?: string; strategyApproval?: { revision: number };
    strategyHistory?: Record<string, { digest: string; revision: number; strategy: { version: number; briefs: Array<{ id: string }> } }>;
    editorialItemStates?: Record<string, { status: string; updatedAt: string }>;
  },
  authority: ProductionAuthority,
  expectedStatus: "selected" | "drafting",
) {
  if (job.stage !== "draft") throw new Error("job is not in draft stage");
  const plan = job.editorialPlan;
  if (!plan || plan.planId !== authority.editorialPlanId) throw new Error("editorial plan mismatch");
  if (job.editorialPlanDigest !== authority.editorialPlanDigest || editorialPlanDigest(plan) !== authority.editorialPlanDigest) throw new Error("editorial plan digest mismatch");
  if (!job.strategyDigest || plan.approvedStrategyDigest !== job.strategyDigest) throw new Error("editorial plan approved strategy digest mismatch");
  const revision = job.strategyApproval?.revision;
  const strategyRecord = revision ? job.strategyHistory?.[`v${revision}`] : undefined;
  if (!strategyRecord || strategyRecord.digest !== job.strategyDigest || strategyRecord.revision !== revision || strategyRecord.strategy.version !== revision) throw new Error("immutable approved strategy history mismatch");
  if (job.selectedNextItemId !== authority.editorialItemId || plan.selectedNextItemId !== authority.editorialItemId) throw new Error("selected editorial item mismatch");
  const item = plan.items.find((candidate) => candidate.id === authority.editorialItemId);
  if (!item || item.briefId !== authority.briefId) throw new Error("selected editorial brief mismatch");
  if (!strategyRecord.strategy.briefs.some((brief) => brief.id === item.briefId)) throw new Error("selected editorial brief missing from immutable strategy history");
  if (job.editorialItemStates?.[authority.editorialItemId]?.status !== expectedStatus) throw new Error(`editorial item lifecycle is not ${expectedStatus}`);
  return item;
}

export function assertEditorialPlanSubmission(
  job: {
    stage: string;
    strategyDigest?: string;
    strategyRevision?: number;
    contentStrategy?: { strategyId: string; version: number };
    strategyApprovalState?: string;
    strategyApproval?: { decision: string; payloadDigest: string; revision: number };
    editorialPlanRevision?: number;
    editorialPlanHistory?: Record<string, unknown>;
    editorialPlanningSnapshot?: import("./types").EditorialPlanningSnapshot;
    editorialPlanningSnapshotDigest?: string;
  },
  plan: EditorialPlan,
  revision: number,
): void {
  if (job.stage !== "plan") throw new Error(`job stage is '${job.stage}'`);
  const expectedRevision = job.editorialPlanRevision ?? 1;
  if (revision !== expectedRevision || plan.version !== revision) throw new Error("stale editorial plan revision");
  if (!job.contentStrategy?.strategyId || job.contentStrategy.version !== job.strategyRevision) throw new Error("persisted strategy identity required");
  if (!job.strategyDigest || plan.approvedStrategyDigest !== job.strategyDigest) throw new Error("editorial plan strategy digest mismatch");
  if (!job.editorialPlanningSnapshot || !job.editorialPlanningSnapshotDigest) throw new Error("persisted editorial planning snapshot required");
  if (plan.planningSnapshotId !== job.editorialPlanningSnapshot.snapshotId) throw new Error("editorial plan planning snapshot mismatch");
  if (plan.planningSnapshotDigest !== job.editorialPlanningSnapshotDigest || editorialPlanningSnapshotDigest(job.editorialPlanningSnapshot) !== job.editorialPlanningSnapshotDigest) throw new Error("editorial plan planning snapshot digest mismatch");
  const approval = job.strategyApproval;
  if (job.strategyApprovalState !== "approved" || approval?.decision !== "approved") throw new Error("approved strategy required for editorial planning");
  if (approval.payloadDigest !== job.strategyDigest || approval.revision !== job.strategyRevision) throw new Error("editorial plan strategy approval binding mismatch");
  if (job.editorialPlanHistory?.[`v${revision}`]) throw new Error(`editorial plan history v${revision} already exists`);
  const selected = plan.items.filter((item) => item.id === plan.selectedNextItemId);
  if (selected.length !== 1 || selected[0].productionStatus !== "planned" || selected[0].dependencies.length > 0) {
    throw new Error("selected item is not eligible for production");
  }
}
