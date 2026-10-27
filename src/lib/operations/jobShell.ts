import { z } from "zod";

import { STAGES, type JobStatus, type Stage } from "../types";

export const jobLifecycleSchema = z.enum([
  "active",
  "needs_you",
  "scheduled",
  "paused",
  "uncertain",
  "failed",
  "settled",
]);
export type JobLifecycle = z.infer<typeof jobLifecycleSchema>;

export const jobControlStateSchema = z.enum(["running", "paused", "cancelled"]);
export type JobControlStateValue = z.infer<typeof jobControlStateSchema>;

export const backgroundLivenessSchema = z.enum(["working", "monitoring"]);
export type BackgroundLiveness = z.infer<typeof backgroundLivenessSchema>;

export interface JobShellInput {
  job: {
    id: string;
    status: JobStatus;
    stage: Stage;
    controlState: JobControlStateValue;
    controlEpoch: number;
    updatedAt: string;
  };
  pendingApprovalCount: number;
  attentionCount: number;
  unknownEffectCount: number;
  lastEventSequence: number;
  scheduledFor?: string;
  currentStep?: string;
  completedSteps?: number;
  totalSteps?: number;
  backgroundLiveness?: BackgroundLiveness;
  nextAttemptAt?: string;
}

export interface JobShell {
  jobId: string;
  lifecycle: JobLifecycle;
  stage: Stage;
  controlState: JobControlStateValue;
  controlEpoch: number;
  currentStep?: string;
  progress: { completedSteps: number; totalSteps: number };
  backgroundLiveness?: BackgroundLiveness;
  lastEventSequence: number;
  lastProgressAt: string;
  nextAttemptAt?: string;
  approvalCount: number;
  attentionCount: number;
  unknownEffectCount: number;
  needsAttention: boolean;
}

export const jobShellSchema = z.object({
  jobId: z.string().min(1).max(300),
  lifecycle: jobLifecycleSchema,
  stage: z.enum(STAGES),
  controlState: jobControlStateSchema,
  controlEpoch: z.number().int().nonnegative(),
  currentStep: z.string().min(1).max(500).optional(),
  progress: z.object({ completedSteps: z.number().int().nonnegative(), totalSteps: z.number().int().positive() }).strict(),
  backgroundLiveness: backgroundLivenessSchema.optional(),
  lastEventSequence: z.number().int().min(-1),
  lastProgressAt: z.string().datetime({ offset: true }),
  nextAttemptAt: z.string().datetime({ offset: true }).optional(),
  approvalCount: z.number().int().nonnegative(),
  attentionCount: z.number().int().nonnegative(),
  unknownEffectCount: z.number().int().nonnegative(),
  needsAttention: z.boolean(),
}).strict();

const runnableStages: readonly Stage[] = STAGES.filter((stage) => stage !== "complete" && stage !== "failed");

function nonNegativeInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 0) throw new Error(`${field} must be a non-negative integer`);
}

function deriveLifecycle(input: JobShellInput): JobLifecycle {
  if (input.unknownEffectCount > 0) return "uncertain";
  if (input.pendingApprovalCount + input.attentionCount > 0) return "needs_you";
  if (input.job.controlState === "paused" || input.job.controlState === "cancelled") return "paused";
  if (input.job.status === "failed") return "failed";
  if (input.scheduledFor) return "scheduled";
  if (input.job.status === "complete") return "settled";
  return "active";
}

export function deriveJobShell(input: JobShellInput): JobShell {
  nonNegativeInteger(input.pendingApprovalCount, "pending approval count");
  nonNegativeInteger(input.attentionCount, "attention count");
  nonNegativeInteger(input.unknownEffectCount, "unknown effect count");
  if (!Number.isInteger(input.lastEventSequence) || input.lastEventSequence < -1) {
    throw new Error("last event sequence must be -1 or a non-negative integer");
  }
  nonNegativeInteger(input.job.controlEpoch, "control epoch");
  if (!Number.isFinite(Date.parse(input.job.updatedAt))) throw new Error("job updatedAt must be a timestamp");

  const inferredCompleted = Math.max(0, runnableStages.indexOf(input.job.stage));
  const completedSteps = input.completedSteps ?? inferredCompleted;
  const totalSteps = input.totalSteps ?? runnableStages.length;
  nonNegativeInteger(completedSteps, "completed progress");
  if (!Number.isInteger(totalSteps) || totalSteps < 1 || completedSteps > totalSteps) {
    throw new Error("progress must have a positive total and completed steps within the total");
  }

  const lifecycle = deriveLifecycle(input);
  const attentionCount = input.pendingApprovalCount + input.attentionCount + input.unknownEffectCount;
  const inferredLiveness = lifecycle === "active" && input.job.status === "running" ? "working" : undefined;

  return jobShellSchema.parse({
    jobId: input.job.id,
    lifecycle,
    stage: input.job.stage,
    controlState: input.job.controlState,
    controlEpoch: input.job.controlEpoch,
    ...(input.currentStep ? { currentStep: input.currentStep } : {}),
    progress: { completedSteps, totalSteps },
    ...(input.backgroundLiveness ?? inferredLiveness
      ? { backgroundLiveness: input.backgroundLiveness ?? inferredLiveness }
      : {}),
    lastEventSequence: input.lastEventSequence,
    lastProgressAt: input.job.updatedAt,
    ...(input.nextAttemptAt ? { nextAttemptAt: input.nextAttemptAt } : {}),
    approvalCount: input.pendingApprovalCount,
    attentionCount,
    unknownEffectCount: input.unknownEffectCount,
    needsAttention: attentionCount > 0,
  });
}
