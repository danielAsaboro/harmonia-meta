import type { JobStatus, Stage } from "../types";
import type { AttentionItem } from "./attention";
import { deriveJobShell, type JobControlStateValue, type JobShell } from "./jobShell";

interface ProjectionJob {
  id: string;
  status: JobStatus;
  stage: Stage;
  controlState: JobControlStateValue;
  controlEpoch: number;
  updatedAt: string;
  actions?: Array<{ approvalState?: string }>;
}

export function compileJobShells(input: {
  jobs: ProjectionJob[];
  attention: Array<Pick<AttentionItem, "id" | "kind" | "jobId">>;
  unknownEffects: Array<{ jobId: string }>;
  lastEventSequence: number;
}): JobShell[] {
  return input.jobs.map((job) => {
    const jobAttention = input.attention.filter((item) => item.jobId === job.id);
    const unknownEffectCount = input.unknownEffects.filter((effect) => effect.jobId === job.id).length;
    const pendingApprovalCount = (job.actions ?? []).filter((action) => action.approvalState === "pending").length;
    const nonApprovalAttention = jobAttention.filter((item) => item.kind !== "approval" && item.kind !== "uncertain_effect").length;
    return deriveJobShell({
      job,
      pendingApprovalCount,
      attentionCount: nonApprovalAttention,
      unknownEffectCount,
      lastEventSequence: input.lastEventSequence,
      currentStep: job.stage.replaceAll("_", " "),
    });
  });
}
