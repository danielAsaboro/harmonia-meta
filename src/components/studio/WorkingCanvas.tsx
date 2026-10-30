"use client";

import { useEffect, useState } from "react";
import type { JobFull, Receipt } from "@/components/jobTypes";
import type { TimelineEvent } from "@/components/Timeline";
import { buildStudioWorkspace } from "@/lib/studio/workspaceModel";
import { latestSurfaceOperations } from "@/lib/a2ui/surfaceSlots";
import { currentJobProgressOperations } from "@/lib/a2ui/liveJobProgress";
import { surfaceRevisionRequest } from "@/lib/a2ui/workspaceActions";
import { operatorStatusForJob, type OperatorStatusKind } from "@/lib/studio/operatorStatus";
import { HarmoniaA2uiHost } from "@/components/a2ui/HarmoniaCatalog";
import { ArtifactBoard } from "./ArtifactBoard";
import { MediaWorkspace } from "./MediaWorkspace";
import { SourcesWorkspace } from "./SourcesWorkspace";
import { StudioEmpty, StudioFailure, StudioLoading } from "./StudioStates";
import { OutputCorrection } from "./OutputCorrection";
import { WrittenWorkspace } from "./WrittenWorkspace";
import { ApprovalDock } from "./ApprovalDock";
import { ProductionWorkspace } from "./ProductionWorkspace";
import { JobBriefCard } from "./JobBriefCard";
import { SinceLastVisit } from "./SinceLastVisit";
import { EditorialCalendar } from "./EditorialCalendar";
import { ProofDrawer } from "./ProofDrawer";

export type CanvasView = "board" | "written" | "visual" | "motion" | "audio" | "calendar" | "sources";

interface WorkingCanvasProps {
  job: JobFull | null;
  events: TimelineEvent[];
  receipts: Receipt[];
  loading?: boolean;
  error?: string | null;
  selectedArtifactId: string | null;
  onSelectedArtifactChange: (artifactId: string | null) => void;
  onRetry?: () => void;
  supplemental?: React.ReactNode;
  operations?: unknown[];
  operationsLive?: boolean;
  approvalBusy?: boolean;
  onDecide?: (jobId: string, actionId: string, decision: "approved" | "rejected") => Promise<void> | void;
  onOperationDecision?: (operationId: string, decision: "approved" | "rejected") => Promise<void> | void;
  onRequestSurfaceRevision?: (message: string) => Promise<void> | void;
  onSealProductionPlan?: (planId: string, planDigest: string) => Promise<void> | void;
  onDecideProductionPlan?: (planId: string, planDigest: string, decision: "approved" | "rejected", feedback?: string) => Promise<void> | void;
}

export function WorkingCanvas({ job, events, receipts, loading, error, selectedArtifactId, onSelectedArtifactChange, onRetry, supplemental, operations = [], operationsLive = false, approvalBusy = false, onDecide, onOperationDecision, onRequestSurfaceRevision, onSealProductionPlan, onDecideProductionPlan }: WorkingCanvasProps) {
  const [view, setView] = useState<CanvasView>("board");
  const [a2uiActionError, setA2uiActionError] = useState<string | null>(null);
  const [proofOpen, setProofOpen] = useState(false);
  const model = job ? buildStudioWorkspace(job, receipts) : null;
  const selectedView: CanvasView | null = selectedArtifactId?.startsWith("artifact:") ? "written"
    : selectedArtifactId?.startsWith("visual:") ? "visual"
      : selectedArtifactId?.startsWith("motion:") ? "motion"
        : selectedArtifactId?.startsWith("audio:") ? "audio"
          : null;
  const visibleView = selectedView ?? view;
  const reviewCount = (model?.pendingActions.length ?? 0) + (job?.productionPlan?.aggregate.state === "sealed" ? 1 : 0) + (job?.stage === "awaiting_strategy_approval" ? 1 : 0);
  const operatorStatus = job ? operatorStatusForJob({ stage: job.stage, status: job.status, failed: Boolean(job.failure), reviewCount }) : null;
  let canvasOperations: unknown[] = [];
  let a2uiError: string | null = null;
  try {
    canvasOperations = operations.length ? latestSurfaceOperations(operations, "canvas") : [];
    if (job) canvasOperations = currentJobProgressOperations(canvasOperations, job);
  } catch (partitionError) {
    canvasOperations = [];
    a2uiError = partitionError instanceof Error ? partitionError.message : String(partitionError);
  }

  useEffect(() => {
    if (!selectedArtifactId) return;
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>(`[data-canvas-artifact="${CSS.escape(selectedArtifactId)}"]`)?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [selectedArtifactId]);

  const tabs: Array<{ key: CanvasView; label: string; count?: number }> = [
    { key: "board", label: "Overview", count: model ? model.written.length + model.visual.length + model.motion.length + model.audio.length : undefined },
    { key: "written", label: "Posts", count: model?.written.length },
    { key: "visual", label: "Images", count: model?.visual.length },
    { key: "motion", label: "Clips", count: model?.motion.length },
    { key: "audio", label: "Audio", count: model?.audio.length },
    { key: "calendar", label: "Calendar", count: job?.editorialPlan?.items.length },
    { key: "sources", label: "Sources", count: model ? model.sources.normalizedSources.length : undefined },
  ];

  function selectFromBoard(artifactId: string, nextView?: string) {
    if (nextView && tabs.some((tab) => tab.key === nextView)) setView(nextView as CanvasView);
    onSelectedArtifactChange(artifactId || null);
  }

  return (
    <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-r-[23px] bg-[#f3f0e8]" data-a2ui-slot="canvas">
      <header className="flex h-[72px] shrink-0 items-center gap-3 border-b border-black/10 px-[22px]">
        <strong className="text-lg font-extrabold">harmonia</strong>
        <span className="min-w-0 truncate text-xs text-[#77736b]">/ {job ? (job.sourceAnalysis?.summary || "Untitled content job").slice(0, 44) : "No campaign"} / Working set</span>
        <span className="ml-auto hidden rounded-full border border-black/10 px-2 py-1.5 text-[11px] text-[#77736b] sm:inline"><b className="text-[#33906a]">✓</b> autosaved</span>
        {job ? <button type="button" aria-label="Open proof and audit trail" aria-expanded={proofOpen} onClick={() => setProofOpen(true)} className="min-h-10 rounded-full border border-black/15 bg-white/60 px-3 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3157ff]">Proof</button> : null}
        {reviewCount > 0 ? <button type="button" onClick={() => { const production = document.getElementById("production-plan-review"); if (job?.productionPlan?.aggregate.state === "sealed" && production) { const workflowDetails = production.closest("details"); if (workflowDetails instanceof HTMLDetailsElement) workflowDetails.open = true; production.scrollIntoView({ behavior: "smooth", block: "center" }); } else { const details = document.querySelector<HTMLDetailsElement>("[aria-label='Approval boundary'] > details"); if (details) details.open = true; } }} className="rounded-full bg-[#11110f] px-3 py-2.5 text-[11px] font-bold text-white">Review <b className="text-[#d8ff3e]">{reviewCount}</b></button> : null}
      </header>
      <div className="flex-1 overflow-y-auto px-[22px] py-5">
        {loading ? <StudioLoading /> : null}
        {!loading && error ? <StudioFailure message={error} onRetry={onRetry} /> : null}
        {!loading && !error && !job ? <StudioEmpty title="Your working canvas is ready">Start a conversation or open a real job. Written posts, visual concepts, clips, video, audio, sources, policy, and verification will assemble here.</StudioEmpty> : null}
        {!loading && !error && job && model ? <>
          {operatorStatus ? <OperatorStatusCard status={operatorStatus} artifactCount={model.written.length + model.visual.length + model.motion.length + model.audio.length} updatedAt={job.updatedAt} /> : null}
          <SinceLastVisit jobId={job.id} updatedAt={job.updatedAt} events={events} />
          <JobBriefCard job={job} />
          {job.failure ? <div className="mb-5"><StudioFailure message={job.failure.publicMessage} details={{ stage: job.failure.stage, code: job.failure.code, ...job.failure.details }} permanent={!job.failure.retryable} onRetry={job.failure.retryable ? onRetry : undefined} onRetryAfterFix={!job.failure.retryable ? onRetry : undefined} /><OutputCorrection key={`${job.id}:${job.controlEpoch}`} job={job} /></div> : null}
          <nav className="mb-[14px] flex gap-1 overflow-x-auto" aria-label="Canvas views">{tabs.map((tab) => <button key={tab.key} type="button" onClick={() => { setView(tab.key); onSelectedArtifactChange(null); }} aria-current={visibleView === tab.key ? "page" : undefined} className={`min-h-10 shrink-0 rounded-full px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3157ff] ${visibleView === tab.key ? "bg-[#11110f] text-white" : "bg-[#e3ded4] text-[#77736b]"}`}><b className={visibleView === tab.key ? "text-[#d8ff3e]" : ""}>{tab.label}</b>{tab.count !== undefined ? ` ${tab.count}` : ""}</button>)}</nav>
          {visibleView === "board" ? <ArtifactBoard job={job} model={model} onSelect={selectFromBoard} /> : null}
          {visibleView === "written" ? <WrittenWorkspace job={job} traceLinks={model.traceLinks} selectedArtifactId={selectedArtifactId} onSelect={onSelectedArtifactChange} onRequestRevision={onRequestSurfaceRevision} /> : null}
          {visibleView === "visual" ? <MediaWorkspace kind="visual" jobId={job.id} assets={model.visual} selectedArtifactId={selectedArtifactId} onSelect={onSelectedArtifactChange} /> : null}
          {visibleView === "motion" ? <MediaWorkspace kind="motion" jobId={job.id} assets={model.motion} selectedArtifactId={selectedArtifactId} onSelect={onSelectedArtifactChange} /> : null}
          {visibleView === "audio" ? <MediaWorkspace kind="audio" jobId={job.id} assets={model.audio} selectedArtifactId={selectedArtifactId} onSelect={onSelectedArtifactChange} /> : null}
          {visibleView === "calendar" ? <EditorialCalendar job={job} /> : null}
          {visibleView === "sources" ? <SourcesWorkspace job={job} receipts={receipts} /> : null}
          {a2uiError ? <div className="mb-5"><StudioFailure message={`A2UI protocol error: ${a2uiError}`} permanent /></div> : null}
          {canvasOperations.length || supplemental || job.productionPlan ? <details className="mt-5 rounded-[16px] border border-black/10 bg-white/55" open={job.productionPlan?.aggregate.state === "sealed"}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3157ff]">Workflow details <span className="ml-auto text-xs font-normal text-black/45">Progress, production plan, and agent presentation</span></summary>
            <div className="border-t border-black/10 p-4">
          {canvasOperations.length ? <HarmoniaA2uiHost key={`${job.id}:${job.stage}:${job.status}`} operations={canvasOperations} live={operationsLive} className="mb-5 flex w-full flex-col gap-3" onAction={(action) => {
            if (action.name !== "request_surface_revision") {
              setA2uiActionError(`Unknown A2UI action: ${action.name}`);
              return;
            }
            const actionJobId = String(action.context.jobId ?? "");
            const draftId = String(action.context.draftId ?? "");
            if (!job || actionJobId !== job.id || !(job.contentArtifacts ?? []).some((artifact) => artifact.id === draftId) || !onRequestSurfaceRevision) {
              setA2uiActionError("The generated revision request did not match the active persisted draft.");
              return;
            }
            setA2uiActionError(null);
            void onRequestSurfaceRevision(surfaceRevisionRequest(actionJobId, draftId));
          }} /> : null}
          {supplemental ? <div className="mb-5">{supplemental}</div> : null}
          <ProductionWorkspace job={job} busy={approvalBusy} onSeal={onSealProductionPlan} onDecide={onDecideProductionPlan} />
            </div>
          </details> : null}
          {a2uiActionError ? <div className="mt-5"><StudioFailure message={`A2UI action blocked: ${a2uiActionError}`} permanent /></div> : null}
        </> : null}
      </div>
      {job ? <ProofDrawer open={proofOpen} job={job} events={events} receipts={receipts} onClose={() => setProofOpen(false)} /> : null}
      {job && onDecide ? <ApprovalDock job={job} jobId={job.id} actions={job.actions} verifications={job.verifications ?? []} receipts={receipts} claims={job.claims ?? []} busy={approvalBusy} onDecide={onDecide} operations={operations} operationsLive={operationsLive} onOperationDecision={onOperationDecision} /> : null}
    </section>
  );
}

const statusColors: Record<OperatorStatusKind, string> = {
  working: "bg-[#e8edff] text-[#3157ff]",
  needs_information: "bg-[#fff0c9] text-[#7b5300]",
  needs_approval: "bg-[#efffb6] text-[#334100]",
  blocked: "bg-[#ffe0d6] text-[#9f2c11]",
  complete: "bg-[#dff7e9] text-[#216c4d]",
};

function OperatorStatusCard({ status, artifactCount, updatedAt }: { status: ReturnType<typeof operatorStatusForJob>; artifactCount: number; updatedAt: string }) {
  return <section aria-label="Job status" className="mb-4 rounded-[18px] border border-black/10 bg-white/75 p-4 sm:p-5">
    <div className="flex flex-wrap items-start gap-4">
      <div className="min-w-0 flex-1">
        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-black ${statusColors[status.kind]}`}>{status.label}</span>
        <h1 className="mt-3 text-[26px] font-extrabold leading-tight tracking-[-0.035em]">{status.headline}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-black/60">{status.detail}</p>
      </div>
      <div className="shrink-0 text-right"><b className="block text-2xl">{artifactCount}</b><span className="text-xs text-black/45">artifact{artifactCount === 1 ? "" : "s"}</span><time className="mt-1 block text-[11px] text-black/40" dateTime={updatedAt}>Updated {new Date(updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time></div>
    </div>
  </section>;
}
