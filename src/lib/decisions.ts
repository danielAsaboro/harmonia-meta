import {
  appendEvent,
  getJob,
  markActionExecuted,
  recordApproval,
  transitionStageWithOutbox,
} from "@/lib/firestore";
import { dispatchStageOutboxRecord } from "@/lib/stageOutboxDispatcher";
import { requireContentOperator } from "@/lib/authority";
import { actionPayloadDigest } from "@/lib/idempotency";
import { currentTenant, type TenantContext } from "@/lib/tenancy";
import type { PlannedAction } from "@/lib/types";
import { materializeExecutableJobCommands } from "@/lib/jobEffectCommands";

export interface ApprovalActor {
  actorType: "firebase_operator" | "telegram_operator";
  actorSubjectId: string;
  authenticationId: string;
  channel: "dashboard" | "telegram";
}

export function approvalActor(context: TenantContext): ApprovalActor {
  const principal = requireContentOperator(context);
  return {
    actorType: principal.kind === "firebase_user" ? "firebase_operator" : "telegram_operator",
    actorSubjectId: principal.subjectId,
    authenticationId: principal.authenticationId,
    channel: principal.kind === "firebase_user" ? "dashboard" : "telegram",
  };
}

export function assertApprovalPayload(action: PlannedAction, expectedPayloadDigest: string): string {
  const actual = actionPayloadDigest(action);
  if (actual !== expectedPayloadDigest) throw new Error("approval payload changed");
  return actual;
}

export interface DecisionOutcome {
  ok: boolean;
  note?: string;
  remainingApprovals?: number;
  triggered?: "publish" | "verify";
}

/**
 * Single writer for approval decisions. Shared by the REST decision route,
 * the chat surface, and any other operator surface so every path through
 * the approval gate behaves identically and emits identical events.
 */
export async function resolveDecision(
  jobId: string,
  actionId: string,
  decision: "approved" | "rejected",
  expectedPayloadDigest: string,
): Promise<DecisionOutcome> {
  const actor = approvalActor(currentTenant());
  const jobBefore = await getJob(jobId);
  const actionBefore = jobBefore.actions.find((candidate) => candidate.id === actionId);
  if (!actionBefore) throw new Error(`action ${actionId} not found on job ${jobId}`);
  assertApprovalPayload(actionBefore, expectedPayloadDigest);
  const action = await recordApproval(jobId, actionId, decision, expectedPayloadDigest, actor);
  await appendEvent(
    jobId,
    jobBefore.stage,
    `${decision} action '${action.title}' (${action.type})`,
    "operator",
  );

  const job = await getJob(jobId);
  if (job.stage !== "awaiting_approval") {
    return { ok: true, note: "job not awaiting approval" };
  }

  const stillPending = job.actions.filter((a) => a.approvalState === "pending");
  if (stillPending.length > 0) {
    return { ok: true, remainingApprovals: stillPending.length };
  }

  const executable = job.actions.filter(
    (a) =>
      a.state === "planned" &&
      (!a.requiresApproval || a.approvalState === "approved"),
  );
  for (const a of job.actions) {
    if (a.approvalState === "rejected" && a.state === "planned") {
      await markActionExecuted(jobId, a.id, "skipped");
      await appendEvent(jobId, "awaiting_approval", `action skipped by rejection: ${a.title}`, "system");
    }
  }

  if (executable.length > 0) {
    await materializeExecutableJobCommands(jobId);
    const outboxId = await transitionStageWithOutbox(jobId, "awaiting_approval", "publish", `${executable.length} approved action(s) dispatched to publishing`);
    try { await dispatchStageOutboxRecord(outboxId); } catch { /* durable tick retries */ }
    return { ok: true, triggered: "publish" };
  }

  const outboxId = await transitionStageWithOutbox(jobId, "awaiting_approval", "verify", "no executable actions; proceeding to verification of existing evidence");
  try { await dispatchStageOutboxRecord(outboxId); } catch { /* durable tick retries */ }
  return { ok: true, triggered: "verify" };
}
