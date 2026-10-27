import { createHash } from "node:crypto";
import { z } from "zod";

import { canonicalJson } from "../recordReplay/integrity";
import type { JobStatus } from "../types";
import { jobControlStateSchema, type JobControlStateValue } from "./jobShell";

export const jobControlActionSchema = z.enum(["pause", "resume", "cancel"]);
export type JobControlAction = z.infer<typeof jobControlActionSchema>;

export const commandActorSchema = z.object({
  actorType: z.enum(["firebase_operator", "telegram_operator"]),
  subjectId: z.string().min(1).max(128),
  authenticationId: z.string().min(1).max(300),
}).strict();
export type CommandActor = z.infer<typeof commandActorSchema>;

export interface CommandEnvelope {
  commandId: string;
  jobId: string;
  action: JobControlAction;
  expectedControlEpoch: number;
  confirmation?: string;
  actor: CommandActor;
  receivedAt: string;
  payloadDigest: string;
}

export interface JobControlState {
  jobId: string;
  status: JobStatus;
  controlState: JobControlStateValue;
  controlEpoch: number;
}

export type JobControlDecision =
  | { accepted: true; next: JobControlState }
  | { accepted: false; errorCode: "stale_control_epoch" | "job_terminal" | "job_not_paused" | "job_already_paused" | "job_cancelled" | "confirmation_required"; error: string; next?: undefined };

export interface CreateCommandEnvelopeInput {
  commandId: string;
  jobId: string;
  action: JobControlAction;
  expectedControlEpoch: number;
  confirmation?: string;
  actor: CommandActor;
  receivedAt: string;
}

function digestPayload(input: CreateCommandEnvelopeInput): string {
  return createHash("sha256").update(canonicalJson({
    commandId: input.commandId,
    jobId: input.jobId,
    action: input.action,
    expectedControlEpoch: input.expectedControlEpoch,
    ...(input.confirmation ? { confirmation: input.confirmation } : {}),
    actor: input.actor,
  })).digest("hex");
}

export function createCommandEnvelope(input: CreateCommandEnvelopeInput): CommandEnvelope {
  if (!/^[A-Za-z0-9:_-]{1,300}$/.test(input.commandId)) throw new Error("invalid command id");
  if (!/^[A-Za-z0-9_-]{1,300}$/.test(input.jobId)) throw new Error("invalid command job id");
  jobControlActionSchema.parse(input.action);
  commandActorSchema.parse(input.actor);
  if (!Number.isInteger(input.expectedControlEpoch) || input.expectedControlEpoch < 0) throw new Error("invalid expected control epoch");
  if (input.confirmation !== undefined && (input.confirmation.length < 1 || input.confirmation.length > 500)) throw new Error("invalid command confirmation");
  if (!Number.isFinite(Date.parse(input.receivedAt))) throw new Error("invalid command receivedAt");
  return { ...input, actor: { ...input.actor }, payloadDigest: digestPayload(input) };
}

function rejected(errorCode: Exclude<JobControlDecision, { accepted: true }>["errorCode"], error: string): JobControlDecision {
  return { accepted: false, errorCode, error };
}

export function decideJobControl(state: JobControlState, command: CommandEnvelope): JobControlDecision {
  jobControlStateSchema.parse(state.controlState);
  if (state.jobId !== command.jobId) throw new Error("job control aggregate mismatch");
  if (state.controlEpoch !== command.expectedControlEpoch) {
    return rejected("stale_control_epoch", `expected control epoch ${command.expectedControlEpoch}, current epoch is ${state.controlEpoch}`);
  }
  if (state.status === "complete") return rejected("job_terminal", "completed jobs cannot be controlled");
  if (state.controlState === "cancelled") return rejected("job_cancelled", "job has already been cancelled");
  let controlState: JobControlStateValue;
  if (command.action === "pause") {
    if (state.controlState === "paused") return rejected("job_already_paused", "job is already paused");
    controlState = "paused";
  } else if (command.action === "resume") {
    if (state.controlState !== "paused") return rejected("job_not_paused", "only paused jobs can be resumed");
    controlState = "running";
  } else {
    if (command.confirmation !== `CANCEL ${state.jobId}`) return rejected("confirmation_required", `type CANCEL ${state.jobId} to confirm cancellation`);
    controlState = "cancelled";
  }
  return { accepted: true, next: { ...state, controlState, controlEpoch: state.controlEpoch + 1 } };
}
