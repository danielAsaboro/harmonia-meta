import { getJob, listReceipts, writeReplayObservation } from "./firestore";
import { claimCommandEffect, listCommandsForJob } from "./effectCommandStore";
import { newId } from "./idempotency";
import { currentTraceId } from "./telemetry";
import { currentTenant, tenantWorkspaceRole, type WorkspaceRole } from "./tenancy";
import type { Job, PlannedAction, Receipt } from "./types";

type JobWithActions = Job & { actions: PlannedAction[] };
type ReplayClaimResult =
  | { outcome: "execute" | "in_progress" | "uncertain" | "paused" | "cancelled" }
  | { outcome: "already_applied"; receiptId: string };

export function replayEligibleReceipt(
  job: JobWithActions,
  actionId: string,
  receipts: Receipt[],
  role: WorkspaceRole,
): Receipt {
  if (role === "service") throw new Error("replay proof requires a human operator");
  const action = job.actions.find((candidate) => candidate.id === actionId);
  if (!action || action.state !== "executed" || (action.requiresApproval && action.approvalState !== "approved")) {
    throw new Error("replay proof requires an approved executed action");
  }
  const receipt = receipts.find((candidate) => candidate.actionId === actionId && candidate.outcome === "applied");
  if (!receipt) throw new Error("replay proof requires an applied receipt");
  return receipt;
}

export function assertReplayApplied(result: ReplayClaimResult): string {
  if (result.outcome !== "already_applied") {
    throw new Error(`replay proof cannot execute an effect (claim outcome: ${result.outcome})`);
  }
  return result.receiptId;
}

export async function requestReplayProof(jobId: string, actionId: string): Promise<{ receiptId: string; operationId: string }> {
  const tenant = currentTenant();
  const [job, receipts, commands] = await Promise.all([
    getJob(jobId), listReceipts(jobId), listCommandsForJob(jobId),
  ]);
  const receipt = replayEligibleReceipt(job, actionId, receipts, tenantWorkspaceRole(tenant));
  const operationId = `${jobId}:replay:${actionId}:${newId()}`;
  const traceId = currentTraceId();
  const command = commands.find((candidate) =>
    candidate.actionId === actionId && candidate.payloadDigest === receipt.idempotencyKey,
  );
  if (!command) throw new Error("replay proof requires the immutable effect command");
  const result = await claimCommandEffect(command.id, {
    operationId, traceId, claimToken: newId(),
  });
  const receiptId = assertReplayApplied(result);
  await writeReplayObservation({
    id: newId(), jobId, actionId, operationId, traceId, receiptId,
    outcome: "already_applied", attemptedAt: new Date().toISOString(),
  });
  return { receiptId, operationId };
}
