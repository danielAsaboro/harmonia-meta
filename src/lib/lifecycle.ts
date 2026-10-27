import type { Job } from "./types";

export interface DeletionCandidate {
  job: Pick<Job, "id" | "status" | "workspaceId" | "brandId"> & {
    retentionHold?: boolean;
  };
  confirmation: string;
  reason: string;
}

export interface DeletionPlan {
  jobId: string;
  workspaceId: string;
  brandId: string;
  reason: string;
  requestedAt: string;
}

export interface WorkspaceDeletionPlan {
  workspaceId: string;
  confirmation: string;
  reason: string;
  requestedAt: string;
}

export function planWorkspaceDeletion(
  workspaceId: string,
  confirmation: string,
  reason: string,
  now = new Date(),
): WorkspaceDeletionPlan {
  if (confirmation !== `DELETE ${workspaceId}`) {
    throw new Error("workspace deletion confirmation must equal DELETE plus the workspace ID");
  }
  if (!reason.trim()) throw new Error("workspace deletion reason is required");
  return { workspaceId, confirmation, reason: reason.trim(), requestedAt: now.toISOString() };
}

export function retentionDeadline(now = new Date(), days = 90): string {
  if (!Number.isInteger(days) || days < 1 || days > 3650) throw new Error("invalid retention period");
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function planJobDeletion(input: DeletionCandidate, now = new Date()): DeletionPlan {
  const { job } = input;
  if (input.confirmation !== job.id) throw new Error("deletion confirmation must equal the job ID");
  if (!input.reason.trim()) throw new Error("deletion reason is required");
  if (job.retentionHold) throw new Error("job is under a retention hold");
  if (job.status !== "complete" && job.status !== "failed") {
    throw new Error("active jobs cannot be deleted");
  }
  return {
    jobId: job.id,
    workspaceId: job.workspaceId,
    brandId: job.brandId,
    reason: input.reason.trim(),
    requestedAt: now.toISOString(),
  };
}

export function deletionTombstone(
  plan: DeletionPlan,
  actorSubjectId: string,
  deletedAt = new Date(),
) {
  return {
    jobId: plan.jobId,
    workspaceId: plan.workspaceId,
    brandId: plan.brandId,
    reason: plan.reason,
    requestedAt: plan.requestedAt,
    deletedAt: deletedAt.toISOString(),
    deletedBySubjectId: actorSubjectId,
    contentErased: true,
  } as const;
}
