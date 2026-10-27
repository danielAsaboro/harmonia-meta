import type { Firestore } from "@google-cloud/firestore";

import { createStageOutboxInTransaction } from "../firestore";
import { invalidateEffectCommand, type EffectCommand } from "../effectCommands";
import { assertResourceWorkspace, currentTenant, tenantCollectionPath, tenantDocumentPath } from "../tenancy";
import type { EffectClaim } from "../types";
import type { JobStatus, Stage } from "../types";
import { decideJobControl, type CommandEnvelope, type JobControlState } from "./commands";
import { jobControlStateSchema, type JobControlStateValue } from "./jobShell";

export interface CommandReceipt {
  commandId: string;
  jobId: string;
  workspaceId: string;
  brandId: string;
  action: CommandEnvelope["action"];
  payloadDigest: string;
  actor: CommandEnvelope["actor"];
  receivedAt: string;
  recordedAt: string;
  accepted: boolean;
  resultingControlEpoch?: number;
  resultingControlState?: JobControlStateValue;
  errorCode?: string;
  error?: string;
}

export class JobControlCommandStore {
  constructor(private readonly firestore: Firestore) {}

  async record(command: CommandEnvelope): Promise<CommandReceipt> {
    const tenant = currentTenant();
    const expectedActorType = tenant.principal.kind === "firebase_user"
      ? "firebase_operator"
      : tenant.principal.kind === "telegram_user"
        ? "telegram_operator"
        : null;
    if (
      command.actor.actorType !== expectedActorType
      || command.actor.subjectId !== tenant.principal.subjectId
      || command.actor.authenticationId !== tenant.principal.authenticationId
    ) throw new Error("job control command actor does not match authenticated tenant principal");

    const jobRef = this.firestore.doc(tenantDocumentPath(tenant, "jobs", command.jobId));
    const receiptRef = jobRef.collection("control_commands").doc(command.commandId);
    return this.firestore.runTransaction(async (transaction) => {
      const [jobSnapshot, receiptSnapshot] = await Promise.all([
        transaction.get(jobRef),
        transaction.get(receiptRef),
      ]);
      if (receiptSnapshot.exists) {
        const receipt = receiptSnapshot.data() as CommandReceipt;
        if (receipt.payloadDigest !== command.payloadDigest) throw new Error("command id was already used with a different payload");
        return receipt;
      }
      if (!jobSnapshot.exists) throw new Error(`job not found: ${command.jobId}`);
      const job = jobSnapshot.data() as {
        workspaceId: string;
        brandId: string;
        status: JobStatus;
        controlState: JobControlStateValue;
        controlEpoch: number;
        stage: Stage;
        actions?: Array<Record<string, unknown>>;
      };
      assertResourceWorkspace(tenant, job);
      const effectSnapshots = command.action === "cancel"
        ? await transaction.get(this.firestore.collection(tenantCollectionPath(tenant, "effect_commands")).where("jobId", "==", command.jobId))
        : null;
      const effectClaims = effectSnapshots
        ? await Promise.all(effectSnapshots.docs.map((snapshot) => transaction.get(snapshot.ref.collection("claims").doc("effect"))))
        : [];
      const state: JobControlState = {
        jobId: command.jobId,
        status: job.status,
        controlState: jobControlStateSchema.parse(job.controlState),
        controlEpoch: job.controlEpoch,
      };
      const decision = decideJobControl(state, command);
      const receipt: CommandReceipt = {
        commandId: command.commandId,
        jobId: command.jobId,
        workspaceId: tenant.workspaceId,
        brandId: tenant.brandId,
        action: command.action,
        payloadDigest: command.payloadDigest,
        actor: command.actor,
        receivedAt: command.receivedAt,
        recordedAt: new Date().toISOString(),
        accepted: decision.accepted,
        ...(decision.accepted ? {
          resultingControlEpoch: decision.next.controlEpoch,
          resultingControlState: decision.next.controlState,
        } : { errorCode: decision.errorCode, error: decision.error }),
      };
      if (decision.accepted) {
        const activeActionIds = new Set<string>();
        if (effectSnapshots) {
          effectSnapshots.docs.forEach((snapshot, index) => {
            const effect = snapshot.data() as EffectCommand;
            const claim = effectClaims[index]?.exists ? effectClaims[index].data() as EffectClaim : null;
            const inFlight = ["dispatched", "observed", "unknown"].includes(effect.state)
              || (claim ? ["claimed", "dispatched", "observed", "unknown"].includes(claim.state) : false);
            if (inFlight) activeActionIds.add(effect.actionId);
            else if (effect.state === "prepared") transaction.set(snapshot.ref, invalidateEffectCommand(effect, `job cancelled by command ${command.commandId}`, receipt.recordedAt));
          });
        }
        const actions = command.action === "cancel"
          ? (job.actions ?? []).map((action) => action.state === "planned" && !activeActionIds.has(String(action.id))
            ? { ...action, state: "skipped", approvalState: "rejected" }
            : action)
          : job.actions;
        transaction.update(jobRef, {
          controlState: decision.next.controlState,
          controlEpoch: decision.next.controlEpoch,
          ...(command.action === "cancel" ? {
            actions,
            terminalOutcome: activeActionIds.size > 0 ? "unresolved" : "rejected",
            status: activeActionIds.size > 0 ? "failed" : "complete",
          } : {}),
          ...(command.action === "resume" ? { status: "running" } : {}),
          updatedAt: receipt.recordedAt,
        });
        if (command.action === "resume") {
          createStageOutboxInTransaction(
            transaction,
            command.jobId,
            job.stage,
            decision.next.controlEpoch,
            { note: `resume command ${command.commandId}` },
          );
        }
      }
      transaction.create(receiptRef, receipt);
      return receipt;
    });
  }
}
