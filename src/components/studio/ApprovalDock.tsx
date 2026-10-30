"use client";

import { useState } from "react";
import type { JobFull, PlannedAction, Receipt } from "@/components/jobTypes";
import { HarmoniaA2uiHost } from "@/components/a2ui/HarmoniaCatalog";
import { latestSurfaceOperations } from "@/lib/a2ui/surfaceSlots";
import { isReplayableAction } from "@/lib/replayEligibility";
import { StudioFailure } from "./StudioStates";

type Verification = NonNullable<JobFull["verifications"]>[number];

function recordedCost(action: PlannedAction): number | null {
  for (const key of ["estimatedCostUsd", "costUsd", "priceUsd"]) {
    const value = action.payload[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return null;
}

function actionTypeLabel(value: string): string {
  return value.replace("publish_x_", "Publish X ").replace("publish_linkedin_", "Publish LinkedIn ").replace("export_", "Export ").replace("generate_", "Generate ").replace("render_", "Render ").replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

function generatedApprovalActionIds(operations: unknown[]): string[] {
  const ids: string[] = [];
  for (const operation of operations) {
    if (!operation || typeof operation !== "object") continue;
    const update = (operation as { updateComponents?: unknown }).updateComponents;
    if (!update || typeof update !== "object") continue;
    const components = (update as { components?: unknown }).components;
    if (!Array.isArray(components)) continue;
    for (const component of components) {
      if (!component || typeof component !== "object") continue;
      const candidate = component as { component?: unknown; actionId?: unknown };
      if (candidate.component === "ApprovalReview" && typeof candidate.actionId === "string") ids.push(candidate.actionId);
    }
  }
  return ids;
}

export function ApprovalDock({ job, jobId, actions, verifications, receipts, claims = [], busy, onDecide, operations = [], operationsLive = false, onOperationDecision }: {
  job?: JobFull;
  jobId: string;
  actions: PlannedAction[];
  verifications: Verification[];
  receipts: Receipt[];
  claims?: NonNullable<JobFull["claims"]>;
  busy: boolean;
  onDecide: (jobId: string, actionId: string, decision: "approved" | "rejected") => Promise<void> | void;
  operations?: unknown[];
  operationsLive?: boolean;
  onOperationDecision?: (operationId: string, decision: "approved" | "rejected") => Promise<void> | void;
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [replayBusy, setReplayBusy] = useState<string | null>(null);
  const [replayStatus, setReplayStatus] = useState<Record<string, string>>({});
  const [strategyFeedback, setStrategyFeedback] = useState("");
  const strategyPending = job?.stage === "awaiting_strategy_approval" && job.strategyApprovalState === "pending" && job.contentStrategy && job.strategyDigest;
  const pending = actions.filter((action) => action.approvalState === "pending" && action.state === "planned");
  const replayable = actions.filter((action) => isReplayableAction(action, receipts, claims));
  let approvalOperations: unknown[] = [];
  let protocolError: string | null = null;
  try {
    approvalOperations = operations.length ? latestSurfaceOperations(operations, "approval") : [];
    const pendingIds = new Set(pending.map((action) => action.id));
    const generatedIds = generatedApprovalActionIds(approvalOperations);
    if (generatedIds.some((actionId) => !pendingIds.has(actionId))) approvalOperations = [];
  } catch (error) {
    protocolError = error instanceof Error ? error.message : String(error);
  }
  if (!strategyPending && !pending.length && !replayable.length && !approvalOperations.length && !protocolError) return null;
  const totalRecordedCost = pending.reduce((sum, action) => sum + (recordedCost(action) ?? 0), 0);
  const decisionCount = pending.length + (strategyPending ? 1 : 0);
  const proofOnly = decisionCount === 0 && replayable.length > 0 && !protocolError;

  async function decideStrategy(decision: "approved" | "rejected") {
    if (!job?.strategyDigest) return;
    if (decision === "rejected" && !strategyFeedback.trim()) { setActionError("Strategy rejection requires feedback."); return; }
    const response = await fetch(`/api/jobs/${jobId}/strategy/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, payloadDigest: job.strategyDigest, ...(decision === "rejected" ? { feedback: strategyFeedback.trim() } : {}) }) });
    const body = await response.json();
    if (!response.ok) { setActionError(body.error ?? "Strategy decision failed"); return; }
    window.location.reload();
  }

  async function proveReplay(action: PlannedAction) {
    setReplayBusy(action.id);
    try {
      const response = await fetch(`/api/jobs/${jobId}/actions/${action.id}/replay`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Replay proof failed");
      setReplayStatus((current) => ({ ...current, [action.id]: `Duplicate suppressed; receipt ${body.receiptId}` }));
    } catch (error) {
      setReplayStatus((current) => ({ ...current, [action.id]: error instanceof Error ? error.message : "Replay proof failed" }));
    } finally {
      setReplayBusy(null);
    }
  }

  return (
    <aside className="shrink-0 border-t border-black/10 bg-[#ebe7de] pb-20 min-[900px]:pb-0" aria-label={proofOnly ? "Verification tools" : "Approval boundary"} aria-busy={busy} data-a2ui-slot="approval">
      <p className="sr-only" role="status" aria-live="polite">{busy ? "Recording operator decision" : proofOnly ? "Verification tools available" : `${decisionCount} approval decisions pending`}</p>
      <details className="group">
        <summary className="flex h-[72px] cursor-pointer list-none items-center gap-3 px-5">
          <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[11px] text-sm font-extrabold ${proofOnly ? "bg-[#dfe7ff] text-[#3157ff]" : "bg-[#d8ff3e]"}`}>{proofOnly ? "✓" : decisionCount}</span>
          <span className="min-w-0"><b className="block text-sm">{proofOnly ? "Verification tools" : "Decisions, not every message"}</b><span className="block truncate text-xs text-[#77736b]">{proofOnly ? "Optional duplicate-suppression evidence" : `${decisionCount} action${decisionCount === 1 ? "" : "s"} waiting at the approval boundary`}</span></span>
          {protocolError ? <span className="ml-auto rounded-full border border-red-300 bg-red-50 px-2 py-1 text-xs text-red-700">protocol error</span> : !proofOnly ? <span className="ml-auto rounded-full border border-[#d2ad63] bg-[#fff2d4] px-2 py-1 text-xs">{decisionCount} unresolved</span> : <span className="ml-auto rounded-full border border-[#9aacdf] bg-[#eef2ff] px-2 py-1 text-xs text-[#3157ff]">Proof</span>}
          {totalRecordedCost > 0 ? <span className="text-xs">Recorded ${totalRecordedCost.toFixed(4)}</span> : null}
          <span className="rounded-[11px] bg-[#11110f] px-3 py-2.5 text-[11px] font-bold text-white">{proofOnly ? "Open tools →" : "Review & decide →"}</span>
        </summary>
        <div className="max-h-[48vh] overflow-y-auto border-t border-black/10 bg-[#fffdf7] p-3 shadow-[0_-14px_34px_rgba(22,21,18,0.08)]">
        {protocolError ? <StudioFailure message={`A2UI protocol error: ${protocolError}`} permanent /> : null}
        {actionError ? <StudioFailure message={`A2UI action blocked: ${actionError}`} permanent /> : null}
        {strategyPending ? <article className="mb-3 border-2 border-[#5165ff] bg-[#f0edff] p-4"><p className="text-xs font-black uppercase tracking-[0.12em] text-[#5165ff]">Strategy approval · v{job.contentStrategy!.version}</p><h3 className="mt-1 font-serif text-xl">{job.contentStrategy!.thesis}</h3><p className="mt-2 text-sm leading-6 text-black/60">Approves the exact four-week strategy before Temi&#39;s bounded editorial-plan proposal. Temi has no external-calendar authority.</p><details className="mt-2"><summary className="cursor-pointer text-xs font-bold">Decision provenance</summary><code className="mt-1 block break-all text-[10px] text-black/45">sha256 {job.strategyDigest}</code></details><textarea value={strategyFeedback} onChange={(event) => setStrategyFeedback(event.target.value)} placeholder="Required feedback when rejecting" className="mt-3 w-full border border-black/20 bg-white p-3 text-sm" maxLength={2000} /><div className="mt-3 flex gap-2"><button type="button" onClick={() => void decideStrategy("rejected")} className="min-h-10 rounded-full border-2 border-black px-4 text-xs font-black">Reject</button><button type="button" onClick={() => void decideStrategy("approved")} className="min-h-10 rounded-full bg-black px-4 text-xs font-black text-white">Approve strategy</button></div></article> : null}
        {approvalOperations.length ? <HarmoniaA2uiHost operations={approvalOperations} live={operationsLive} onAction={(action) => {
        if (action.name === "decide_operation" && onOperationDecision) {
          const operationId = String(action.context.operationId ?? "");
          const decision = action.context.decision;
          if (operationId && (decision === "approved" || decision === "rejected")) {
            setActionError(null);
            void onOperationDecision(operationId, decision);
            return;
          }
        }
        if (action.name === "decide_job_action") {
          const actionJobId = String(action.context.jobId ?? "");
          const actionId = String(action.context.actionId ?? "");
          const decision = action.context.decision;
          if (actionJobId === jobId && actions.some((candidate) => candidate.id === actionId) && (decision === "approved" || decision === "rejected")) {
            setActionError(null);
            void onDecide(actionJobId, actionId, decision);
            return;
          }
        }
        setActionError(`Unknown or invalid A2UI action: ${action.name}`);
        }} /> : null}
        {pending.map((action) => {
        const cost = recordedCost(action);
        const relatedReceipts = receipts.filter((receipt) => receipt.actionId === action.id);
        const verifiedCount = verifications.filter((verification) => verification.verified).length;
        const preview = typeof action.payload.text === "string" ? action.payload.text : typeof action.payload.prompt === "string" ? action.payload.prompt : null;
        return (
          <details key={action.id} data-action-id={action.id} className="group/action">
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 p-2"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#ff5c35] text-lg text-white">!</span><span className="min-w-0 flex-1"><span className="block text-xs font-black uppercase tracking-[0.13em]">{pending.length} decision{pending.length === 1 ? "" : "s"} waiting</span><span className="block truncate text-xs text-black/45">{actionTypeLabel(action.type)} · {action.risk} risk</span></span><span className="rounded-full border border-black/20 px-3 py-1 text-xs font-bold group-open:bg-black group-open:text-white">Review</span></summary>
            <section className="mx-2 mb-2 grid gap-4 border border-black/15 bg-[#f4f0e8] p-4 xl:grid-cols-[1fr_auto]">
              <div><div className="flex flex-wrap items-center gap-2"><h3 className="font-serif text-xl">{action.title}</h3><span className="bg-[#161512] px-2 py-1 text-xs font-black uppercase tracking-wider text-white">{action.risk} risk</span></div><p className="mt-2 text-sm leading-6 text-black/65">{action.description || "Publishing remains blocked until you decide."}</p><p className="mt-1 text-xs font-bold text-[#9f2c11]">Publishing remains blocked until you decide.</p>{preview ? <div className="mt-3 max-h-28 overflow-y-auto border-l-2 border-[#ff5c35] bg-white/65 p-3 text-sm leading-6">{preview}</div> : null}<div className="mt-3 flex flex-wrap gap-2 text-xs font-bold uppercase tracking-[0.08em] text-black/45"><span>{verifiedCount} verified evidence item{verifiedCount === 1 ? "" : "s"}</span><span>·</span><span>{relatedReceipts.length} existing receipt{relatedReceipts.length === 1 ? "" : "s"}</span>{cost !== null ? <><span>·</span><span>${cost.toFixed(4)} recorded cost</span></> : null}</div></div>
              <div className="flex items-end gap-2 max-[899px]:sticky max-[899px]:bottom-0 max-[899px]:z-10 max-[899px]:bg-[#f4f0e8] max-[899px]:py-2"><button type="button" aria-label={`Reject ${action.title}`} disabled={busy} onClick={() => void onDecide(jobId, action.id, "rejected")} className="rounded-full border-2 border-[#161512] px-5 py-2.5 text-xs font-black uppercase tracking-wider disabled:opacity-40">Reject</button><button type="button" aria-label={`Approve ${action.title}`} disabled={busy} onClick={() => void onDecide(jobId, action.id, "approved")} className="rounded-full bg-[#161512] px-5 py-3 text-xs font-black uppercase tracking-wider text-white shadow-[4px_4px_0_#d9ff43] disabled:opacity-40">Approve</button></div>
            </section>
          </details>
        );
        })}
        {replayable.map((action) => (
          <section key={`replay-${action.id}`} className="mx-2 mb-2 flex flex-wrap items-center justify-between gap-3 border border-blue-200 bg-blue-50 p-3">
            <div><b className="text-xs">Idempotency proof · {action.title}</b><p role="status" aria-live="polite" className="text-[10px] text-blue-700">{replayStatus[action.id] ?? "No replay attempted in this view."}</p></div>
            <button type="button" aria-label={`Replay proof for ${action.title}`} disabled={busy || replayBusy !== null} onClick={() => void proveReplay(action)} className="rounded-full border border-blue-700 px-3 py-1.5 text-xs font-bold text-blue-800 disabled:opacity-40">Prove duplicate suppression</button>
          </section>
        ))}
        </div>
      </details>
    </aside>
  );
}
