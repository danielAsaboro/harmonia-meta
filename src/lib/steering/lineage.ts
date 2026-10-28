import type { Stage } from "../types";
import type { JobNudge, NudgeImpact } from "./contracts";
import { impactDigest } from "./contracts";
const ORDER: Stage[] = ["collect_sources", "extract_sources", "understand", "strategize", "awaiting_strategy_approval", "plan", "draft", "awaiting_approval", "publish", "verify", "learn", "complete"];
export function dependentLineage(stage: Stage): Stage[] { const index = ORDER.indexOf(stage); return index < 0 ? [] : ORDER.slice(index + 1); }
export function calculateNudgeImpact(job: { id: string; stage: Stage }, nudge: JobNudge): NudgeImpact { const invalidatedStages = nudge.scope === "current_stage" ? dependentLineage(job.stage) : nudge.scope === "remaining_job" ? [job.stage, ...dependentLineage(job.stage)] : ["draft", "awaiting_approval", "publish", "verify", "learn", "complete"]; const base = { jobId: job.id, nudgeId: nudge.id, invalidatedStages, revokesApprovals: invalidatedStages.some((stage) => stage.includes("approval") || stage === "publish"), cancelsPendingEffects: invalidatedStages.includes("publish"), preservesExecutedReceipts: true as const }; return { ...base, digest: impactDigest(base) }; }
