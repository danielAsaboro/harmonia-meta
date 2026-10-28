import { randomUUID } from "node:crypto";
import { createStageOutboxInTransaction, db, getJob } from "../firestore";
import { currentTenant, tenantSubjectId } from "../tenancy";
import { assertResourceWorkspace, tenantCollectionPath } from "../tenancy";
import { invalidateEffectCommand, type EffectCommand } from "../effectCommands";
import type { JobNudge, NudgeImpact } from "./contracts";
import { jobNudgeSchema } from "./contracts";
import { calculateNudgeImpact } from "./lineage";
import type { Stage } from "../types";

const scopedJob = (jobId: string) => db().doc(`workspaces/${currentTenant().workspaceId}/jobs/${jobId}`);
const commandsForJob = (jobId: string) => db().collection(tenantCollectionPath(currentTenant(), "effect_commands")).where("jobId", "==", jobId);

function resumableStage(stage: Stage): Stage {
  if (stage === "awaiting_approval") return "draft";
  if (stage === "awaiting_strategy_approval") return "strategize";
  if (stage === "awaiting_source_resolution") return "extract_sources";
  if (stage === "complete" || stage === "failed") throw new Error(`cannot steer terminal stage ${stage}`);
  return stage;
}

function invalidatePreparedCommands(transaction: FirebaseFirestore.Transaction, snapshots: FirebaseFirestore.QuerySnapshot, reason: string, now: string): void {
  for (const snapshot of snapshots.docs) {
    const command = snapshot.data() as EffectCommand;
    if (command.state === "prepared") transaction.set(snapshot.ref, invalidateEffectCommand(command, reason, now));
  }
}

export async function proposeNudge(jobId: string, input: Pick<JobNudge, "scope" | "contentItemId" | "instruction">): Promise<{ nudge: JobNudge; impact: NudgeImpact }> {
  const job = await getJob(jobId);
  const nudge = jobNudgeSchema.parse({ ...input, id: randomUUID(), jobId, expectedControlEpoch: job.controlEpoch ?? 0, proposedBySubjectId: tenantSubjectId(currentTenant()), proposedAt: new Date().toISOString() });
  const impact = calculateNudgeImpact(job, nudge);
  await scopedJob(jobId).collection("nudges").doc(nudge.id).create({ ...nudge, impact, status: "proposed" });
  return { nudge, impact };
}

export interface SteeringDispatch { controlEpoch: number; outboxId: string }

export async function applyNudge(jobId: string, nudgeId: string, expectedImpactDigest: string): Promise<SteeringDispatch> {
  const ref = scopedJob(jobId);
  return db().runTransaction(async (transaction) => {
    const [jobSnapshot, nudgeSnapshot, commandSnapshots] = await Promise.all([transaction.get(ref), transaction.get(ref.collection("nudges").doc(nudgeId)), transaction.get(commandsForJob(jobId))]);
    if (!jobSnapshot.exists || !nudgeSnapshot.exists) throw new Error("job or nudge not found");
    const job = jobSnapshot.data()!; const nudge = nudgeSnapshot.data() as JobNudge & { impact: NudgeImpact; status: string };
    assertResourceWorkspace(currentTenant(), job as { workspaceId: string; brandId?: string });
    if (nudge.status !== "proposed" || nudge.expectedControlEpoch !== (job.controlEpoch ?? 0)) throw new Error("stale steering epoch");
    if (nudge.impact.digest !== expectedImpactDigest) throw new Error("steering impact digest mismatch");
    const epoch = (job.controlEpoch ?? 0) + 1;
    const actions = Array.isArray(job.actions) ? job.actions.map((action: Record<string, unknown>) => action.state === "planned" && action.approvalState === "approved" ? { ...action, approvalState: "pending" } : action) : [];
    const appliedAt = new Date().toISOString(); const steeringInstructions = [...((job.steeringInstructions as unknown[]) ?? []), { nudgeId: nudge.id, scope: nudge.scope, ...(nudge.contentItemId ? { contentItemId: nudge.contentItemId } : {}), instruction: nudge.instruction, appliedAt, controlEpoch: epoch }];
    const targetStage = resumableStage(job.stage as Stage);
    transaction.update(ref, { controlEpoch: epoch, controlState: "running", stage: targetStage, status: "running", actions, steeringInstructions, ...(nudge.impact.revokesApprovals ? { strategyApprovalState: "pending" } : {}), updatedAt: appliedAt });
    invalidatePreparedCommands(transaction, commandSnapshots, `invalidated by steering nudge ${nudge.id}`, appliedAt);
    transaction.update(nudgeSnapshot.ref, { status: "applied", appliedAt, appliedControlEpoch: epoch });
    const outboxId = createStageOutboxInTransaction(transaction, jobId, targetStage, epoch, { note: `steering nudge ${nudge.id}` });
    return { controlEpoch: epoch, outboxId };
  });
}

export async function redoJobStage(jobId: string, expectedEpoch: number, targetStage: Stage, confirmation: string): Promise<SteeringDispatch> {
  if (confirmation !== `REDO ${targetStage}`) throw new Error(`confirmation must equal REDO ${targetStage}`);
  const ref = scopedJob(jobId);
  return db().runTransaction(async (transaction) => {
    const [snapshot, commandSnapshots] = await Promise.all([transaction.get(ref), transaction.get(commandsForJob(jobId))]); if (!snapshot.exists || (snapshot.get("controlEpoch") ?? 0) !== expectedEpoch) throw new Error("stale steering epoch");
    assertResourceWorkspace(currentTenant(), snapshot.data()! as { workspaceId: string; brandId?: string });
    const existingStage = snapshot.get("stage") as Stage;
    const actions = (snapshot.get("actions") as Array<Record<string, unknown>> | undefined) ?? [];
    const crossesExecutedEffects = actions.some((action) => action.state === "executed") && ["collect_sources", "extract_sources", "understand", "strategize", "awaiting_strategy_approval", "plan", "draft", "awaiting_approval", "publish"].includes(targetStage);
    if (crossesExecutedEffects) throw new Error("cannot redo across executed external effects; create a new job instead");
    const epoch = expectedEpoch + 1;
    const invalidatedActions = actions.map((action) => action.state === "planned" ? { ...action, approvalState: "pending" } : action);
    const updatedAt = new Date().toISOString();
    const strategyApprovalState = snapshot.get("strategyApprovalState") as string | undefined;
    transaction.update(ref, { controlEpoch: epoch, controlState: "running", stage: targetStage, status: "running", actions: invalidatedActions, ...(targetStage === "strategize" ? { strategyApprovalState: "pending" } : strategyApprovalState ? { strategyApprovalState } : {}), updatedAt });
    invalidatePreparedCommands(transaction, commandSnapshots, `invalidated by redo ${targetStage}`, updatedAt);
    const outboxId = createStageOutboxInTransaction(transaction, jobId, targetStage, epoch, { completedStage: existingStage, note: `operator redo from ${existingStage}` });
    return { controlEpoch: epoch, outboxId };
  });
}
