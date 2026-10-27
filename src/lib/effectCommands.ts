import { createHash } from "node:crypto";

import type { ActionType } from "./types";

export type EffectCommandAuthorization =
  | { kind: "approval"; approvalId: string; approvedPayloadDigest: string }
  | { kind: "mandate"; mandateId: string; mandateDigest: string; authorizedPayloadDigest: string };

export type EffectCommandState = "prepared" | "dispatched" | "waiting_provider" | "observed" | "applied" | "failed" | "unknown" | "cancelled";
export type EffectObservedOutcome = "applied" | "already_applied" | "rejected" | "failed";

export interface EffectCommand {
  id: string;
  workspaceId: string;
  brandId: string;
  sourceKind: "job_action" | "scheduled_content";
  sourceId: string;
  jobId: string;
  actionId: string;
  actionType: ActionType;
  payload: Record<string, unknown>;
  dependsOnCommandIds?: string[];
  payloadDigest: string;
  authorization: EffectCommandAuthorization;
  executeAfter?: string;
  state: EffectCommandState;
  createdAt: string;
  updatedAt: string;
  invalidatedReason?: string;
  operationId?: string;
  operationEpoch?: number;
  dispatchAttempt?: number;
  dispatchedAt?: string;
  observedAt?: string;
  observedOutcome?: EffectObservedOutcome;
  observationDigest?: string;
  observation?: { outcome: EffectObservedOutcome; artifact?: unknown; detail: Record<string, unknown> };
  unknownReason?: string;
  providerOperationId?: string;
  nextPollAt?: string;
  progress?: { kind: "x_thread"; confirmedPostIds: string[] };
  progressUpdatedAt?: string;
}

export interface EffectCommandInput {
  id: string;
  workspaceId: string;
  brandId: string;
  sourceKind: EffectCommand["sourceKind"];
  sourceId: string;
  jobId: string;
  actionId: string;
  actionType: ActionType;
  payload: Record<string, unknown>;
  dependsOnCommandIds?: string[];
  authorization: EffectCommandAuthorization;
  executeAfter?: string;
  now?: string;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("effect command contains a non-finite number");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    for (const [, item] of entries) {
      if (item === undefined) throw new Error("effect command contains undefined");
    }
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  }
  throw new Error("effect command contains an unsupported value");
}

export function effectCommandDigest(input: Omit<EffectCommandInput, "authorization" | "now"> | EffectCommandInput | EffectCommand): string {
  const dependencies = [...(input.dependsOnCommandIds ?? [])].sort();
  return createHash("sha256").update(canonicalJson({
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    jobId: input.jobId,
    actionId: input.actionId,
    actionType: input.actionType,
    payload: input.payload,
    ...(dependencies.length > 0 ? { dependsOnCommandIds: dependencies } : {}),
    executeAfter: input.executeAfter ?? null,
  })).digest("hex");
}

export function createEffectCommand(input: EffectCommandInput): EffectCommand {
  const payloadDigest = effectCommandDigest(input);
  const authorizedDigest = input.authorization.kind === "approval"
    ? input.authorization.approvedPayloadDigest
    : input.authorization.authorizedPayloadDigest;
  if (authorizedDigest !== payloadDigest) {
    throw new Error(input.authorization.kind === "approval"
      ? "approval payload digest mismatch"
      : "mandate payload digest mismatch");
  }
  if (input.authorization.kind === "mandate" && !/^[a-f0-9]{64}$/.test(input.authorization.mandateDigest)) {
    throw new Error("invalid mandate digest");
  }
  const now = input.now ?? new Date().toISOString();
  const dependsOnCommandIds = [...new Set(input.dependsOnCommandIds ?? [])].sort();
  if (dependsOnCommandIds.includes(input.id)) throw new Error("effect command cannot depend on itself");
  if (dependsOnCommandIds.length !== (input.dependsOnCommandIds ?? []).length) {
    throw new Error("effect command contains duplicate dependencies");
  }
  return {
    id: input.id,
    workspaceId: input.workspaceId,
    brandId: input.brandId,
    sourceKind: input.sourceKind,
    sourceId: input.sourceId,
    jobId: input.jobId,
    actionId: input.actionId,
    actionType: input.actionType,
    payload: structuredClone(input.payload),
    ...(dependsOnCommandIds.length > 0 ? { dependsOnCommandIds } : {}),
    payloadDigest,
    authorization: structuredClone(input.authorization),
    ...(input.executeAfter ? { executeAfter: input.executeAfter } : {}),
    state: "prepared",
    createdAt: now,
    updatedAt: now,
  };
}

export function invalidateEffectCommand(command: EffectCommand, reason: string, now = new Date().toISOString()): EffectCommand {
  if (command.state !== "prepared") throw new Error(`cannot invalidate ${command.state} effect command`);
  return { ...command, state: "cancelled", invalidatedReason: reason, updatedAt: now };
}

interface EffectFence { operationId: string; operationEpoch: number }

function assertEffectFence(command: EffectCommand, fence: EffectFence): void {
  if (command.operationId !== fence.operationId || command.operationEpoch !== fence.operationEpoch) {
    throw new Error("effect command operation fence mismatch");
  }
}

export function markEffectDispatched(
  command: EffectCommand,
  input: EffectFence & { attempt: number; now: string },
): EffectCommand {
  if (command.state === "dispatched") {
    assertEffectFence(command, input);
    return command;
  }
  if (command.state !== "prepared" && command.state !== "waiting_provider") throw new Error(`cannot dispatch ${command.state} effect command`);
  if (command.state === "waiting_provider" && command.operationId !== input.operationId) throw new Error("provider resume operation id mismatch");
  if (!Number.isInteger(input.operationEpoch) || input.operationEpoch < 1 || !Number.isInteger(input.attempt) || input.attempt < 1) {
    throw new Error("invalid effect dispatch fence");
  }
  return {
    ...command, state: "dispatched", operationId: input.operationId,
    operationEpoch: input.operationEpoch, dispatchAttempt: input.attempt,
    dispatchedAt: input.now, updatedAt: input.now,
  };
}

export function markEffectWaitingProvider(
  command: EffectCommand,
  input: EffectFence & { providerOperationId: string; nextPollAt: string; now: string },
): EffectCommand {
  if (command.state !== "dispatched") throw new Error(`cannot wait from ${command.state} effect command`);
  assertEffectFence(command, input);
  if (!input.providerOperationId.trim()) throw new Error("provider operation id is required");
  if (!Number.isFinite(Date.parse(input.nextPollAt)) || Date.parse(input.nextPollAt) <= Date.parse(input.now)) throw new Error("next provider poll must be in the future");
  return { ...command, state: "waiting_provider", providerOperationId: input.providerOperationId, nextPollAt: input.nextPollAt, updatedAt: input.now };
}

export function markEffectObserved(
  command: EffectCommand,
  input: EffectFence & { outcome: EffectObservedOutcome; artifact?: unknown; detail: Record<string, unknown>; now: string },
): EffectCommand {
  if (command.state !== "dispatched") throw new Error(`cannot observe ${command.state} effect command`);
  assertEffectFence(command, input);
  const observation = {
    outcome: input.outcome,
    ...(input.artifact === undefined ? {} : { artifact: structuredClone(input.artifact) }),
    detail: structuredClone(input.detail),
  };
  return {
    ...command, state: "observed", observedAt: input.now,
    observedOutcome: input.outcome,
    observationDigest: createHash("sha256").update(canonicalJson(observation)).digest("hex"),
    observation, updatedAt: input.now,
  };
}

export function markEffectProgress(
  command: EffectCommand,
  input: EffectFence & {
    progress: { kind: "x_thread"; confirmedPostIds: string[] };
    now: string;
  },
): EffectCommand {
  if (command.state !== "dispatched") throw new Error(`cannot progress ${command.state} effect command`);
  assertEffectFence(command, input);
  const ids = input.progress.confirmedPostIds;
  if (ids.length < 1 || ids.some((id) => !id.trim()) || new Set(ids).size !== ids.length) {
    throw new Error("X thread progress requires unique confirmed post IDs");
  }
  const prior = command.progress?.confirmedPostIds ?? [];
  if (ids.length < prior.length || prior.some((id, index) => ids[index] !== id)) {
    throw new Error("X thread progress cannot discard or rewrite confirmed posts");
  }
  return {
    ...command,
    progress: structuredClone(input.progress),
    progressUpdatedAt: input.now,
    updatedAt: input.now,
  };
}

export function markEffectUnknown(
  command: EffectCommand,
  input: EffectFence & { reason: string; now: string },
): EffectCommand {
  if (command.state !== "dispatched") throw new Error(`cannot mark ${command.state} effect command unknown`);
  assertEffectFence(command, input);
  if (!input.reason.trim()) throw new Error("unknown effect requires a reason");
  return { ...command, state: "unknown", unknownReason: input.reason, updatedAt: input.now };
}

export function restoreEffectPrepared(
  command: EffectCommand,
  input: EffectFence & { proof: "provider_not_started"; now: string },
): EffectCommand {
  if (input.proof !== "provider_not_started") throw new Error("effect retry requires provider_not_started proof");
  if (command.state !== "dispatched") throw new Error(`cannot restore ${command.state} effect command`);
  assertEffectFence(command, input);
  const next = { ...command, state: "prepared" as const, updatedAt: input.now };
  delete next.operationId;
  delete next.operationEpoch;
  delete next.dispatchedAt;
  delete next.observedAt;
  delete next.observedOutcome;
  delete next.observationDigest;
  delete next.observation;
  delete next.unknownReason;
  return next;
}

export function decideTerminalOutcome(commands: Array<Pick<EffectCommand, "state">>): "succeeded" | "partial" | "failed" | "unresolved" {
  if (commands.length === 0 || commands.some((command) => ["prepared", "dispatched", "waiting_provider", "observed", "unknown"].includes(command.state))) {
    return "unresolved";
  }
  const applied = commands.some((command) => command.state === "applied");
  const failed = commands.some((command) => command.state === "failed");
  if (applied && failed) return "partial";
  if (failed) return "failed";
  return "succeeded";
}
