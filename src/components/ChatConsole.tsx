"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useRouter } from "next/navigation";
import type { ComposerAttachment } from "@/components/a2ui/AttachmentComposer";
import type { TimelineEvent } from "@/components/Timeline";
import type { JobFull, Receipt } from "@/components/jobTypes";
import { ConversationPane } from "@/components/studio/ConversationPane";
import { StudioShell } from "@/components/studio/StudioShell";
import { WorkingCanvas } from "@/components/studio/WorkingCanvas";
import { useHarmoniaChat } from "@/hooks/useHarmoniaChat";
import type { ChatRunState } from "@/lib/a2ui/chatReducer";
import { historyRunState } from "@/lib/a2ui/historyReplay";
import { latestSurfaceOperations } from "@/lib/a2ui/surfaceSlots";
import { apiFetch } from "@/lib/clientApi";
import { conversationPath, dayLabel, groupSessions, sessionPreview, type ConsoleMessage } from "@/lib/chatSessions";
import { activeJobIdForConversation, buildStudioChapters } from "@/lib/studio/conversationModel";
import { startJobRefresh } from "@/lib/jobRefresh";

export interface JobDetailBundle {
  job: JobFull;
  events: TimelineEvent[];
  receipts: Receipt[];
}

async function readJobDetail(jobId: string, signal: AbortSignal): Promise<JobDetailBundle> {
  const response = await fetch(`/api/jobs/${jobId}`, { cache: "no-store", signal });
  const body = await response.json().catch(() => null) as { job?: JobFull; events?: TimelineEvent[]; receipts?: Receipt[]; decisions?: NonNullable<JobFull["decisions"]>; claims?: NonNullable<JobFull["claims"]>; assets?: NonNullable<JobFull["assets"]>; error?: string } | null;
  if (!response.ok || !body?.job) throw new Error(body?.error ?? `Unable to load job (${response.status})`);
  return { job: { ...body.job, decisions: body.decisions ?? body.job.decisions ?? [], claims: body.claims ?? body.job.claims ?? [], assets: body.assets ?? body.job.assets ?? [] }, events: body.events ?? [], receipts: body.receipts ?? [] };
}

interface StudioConsoleViewProps {
  messages: ConsoleMessage[];
  loaded: boolean;
  detail: JobDetailBundle | null;
  detailLoading?: boolean;
  detailError?: string | null;
  liveRun: ChatRunState | null;
  input: string;
  onInputChange: (value: string) => void;
  attachments: ComposerAttachment[];
  onAttachmentsChange: Dispatch<SetStateAction<ComposerAttachment[]>>;
  busy: boolean;
  onSend: (message?: string) => void | Promise<void>;
  onOpenJob: (jobId: string) => void;
  selectedArtifactId: string | null;
  onSelectedArtifactChange: (artifactId: string | null) => void;
  mobilePane: "conversation" | "canvas";
  onMobilePaneChange: (pane: "conversation" | "canvas") => void;
  onDecide: (jobId: string, actionId: string, decision: "approved" | "rejected") => Promise<void> | void;
  onOperationDecision: (operationId: string, decision: "approved" | "rejected") => Promise<void> | void;
  onSealProductionPlan?: (planId: string, planDigest: string) => Promise<void> | void;
  onDecideProductionPlan?: (planId: string, planDigest: string, decision: "approved" | "rejected", feedback?: string) => Promise<void> | void;
  onRetryJob?: () => void;
  historyAccessory?: ReactNode;
  historyDrawer?: ReactNode;
}

export function StudioConsoleView(props: StudioConsoleViewProps) {
  const chapters = useMemo(() => buildStudioChapters(props.messages), [props.messages]);
  const workspace = props.detail?.job;
  const campaignTitle = workspace?.sourceAnalysis?.summary || (workspace ? `Source bundle ${workspace.config.sourceManifestId.slice(0, 8)}` : "Untitled campaign");
  const artifactCount = workspace ? (workspace.contentArtifacts?.length ?? 0) + (workspace.assets?.length ?? 0) : 0;
  const lastPersistedRunMessage = [...props.messages].reverse().find((message) => message.run);
  const persistedRunMatchesCanvas = Boolean(
    lastPersistedRunMessage?.run && props.detail?.job.id && (
      lastPersistedRunMessage.data?.jobId === props.detail.job.id ||
      lastPersistedRunMessage.data?.job?.id === props.detail.job.id ||
      lastPersistedRunMessage.run.jobUpdates.some((update) => update.jobId === props.detail?.job.id)
    ),
  );
  const canvasRun = props.liveRun ?? (persistedRunMatchesCanvas ? lastPersistedRunMessage?.run : null) ?? null;
  let generatedWorkspaceCount = 0;
  try {
    generatedWorkspaceCount = canvasRun?.operations.length && latestSurfaceOperations(canvasRun.operations, "canvas").length ? 1 : 0;
  } catch {
    generatedWorkspaceCount = 0;
  }
  const approvalCount = (workspace?.actions.filter((action) => action.approvalState === "pending" && action.state === "planned").length ?? 0)
    + (workspace?.productionPlan?.aggregate.state === "sealed" ? 1 : 0);
  return (<>
    <StudioShell
      mobilePane={props.mobilePane}
      onMobilePaneChange={props.onMobilePaneChange}
      canvasBadge={generatedWorkspaceCount}
      approvalBadge={approvalCount}
      conversation={<ConversationPane chapters={chapters} liveRun={props.liveRun} loaded={props.loaded} input={props.input} onInputChange={props.onInputChange} attachments={props.attachments} onAttachmentsChange={props.onAttachmentsChange} busy={props.busy} onSend={props.onSend} onActivateArtifact={(artifactId) => { props.onSelectedArtifactChange(artifactId); props.onMobilePaneChange("canvas"); }} onActivateJob={(jobId) => { props.onOpenJob(jobId); props.onMobilePaneChange("canvas"); }} headerAccessory={props.historyAccessory} campaignTitle={campaignTitle} artifactCount={artifactCount} />}
      canvas={<WorkingCanvas job={props.detail?.job ?? null} events={props.detail?.events ?? []} receipts={props.detail?.receipts ?? []} loading={props.detailLoading} error={props.detailError} selectedArtifactId={props.selectedArtifactId} onSelectedArtifactChange={props.onSelectedArtifactChange} onRetry={props.onRetryJob} operations={canvasRun?.operations ?? []} operationsLive={props.liveRun?.status === "running"} approvalBusy={props.busy} onDecide={props.onDecide} onOperationDecision={props.onOperationDecision} onRequestSurfaceRevision={props.onSend} onSealProductionPlan={props.onSealProductionPlan} onDecideProductionPlan={props.onDecideProductionPlan} />}
    />
    {props.historyDrawer}
  </>);
}

export default function ChatConsole({ conversationId }: { conversationId?: string }) {
  const router = useRouter();
  const [messages, setMessages] = useState<ConsoleMessage[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const [detail, setDetail] = useState<JobDetailBundle | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(conversationId ?? null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null);
  const [mobilePane, setMobilePane] = useState<"conversation" | "canvas">("conversation");
  const completedRuns = useRef(new Set<string>());
  const submittedConversationId = useRef<string | null>(conversationId ?? null);
  const detailRequest = useRef<AbortController | null>(null);
  const chat = useHarmoniaChat();

  useEffect(() => {
    if (!conversationId) return;
    setActiveConversationId(conversationId);
  }, [conversationId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetch("/api/chat/history?limit=300&all=1", { cache: "no-store" })
        .then((response) => response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`)))
        .then(async (body: { messages: Array<{ id?: string; conversationId?: string; role: string; text: string; data?: ConsoleMessage["data"]; surface?: string; at?: string | null }> }) => {
          const hydrated = await Promise.all(body.messages.map(async (message): Promise<ConsoleMessage> => {
            let run: ChatRunState | undefined;
            if (message.role === "assistant" && message.data?.chatRunId) {
              try {
                const response = await fetch(`/api/chat/runs/${message.data.chatRunId}/events?after=-1`, { cache: "no-store" });
                const replay = await response.json().catch(() => null) as { events?: unknown[]; error?: string } | null;
                if (!response.ok) throw new Error(replay?.error ?? `HTTP ${response.status}`);
                run = historyRunState(message.data.chatRunId, Array.isArray(replay?.events) ? replay.events : []);
              } catch (error) {
                run = historyRunState(message.data.chatRunId, [{ type: "run_failed", runId: message.data.chatRunId, sequence: 0, failedAt: new Date().toISOString(), error: `Chat history replay unavailable: ${error instanceof Error ? error.message : String(error)}`, permanent: false }]);
              }
            }
            return { id: message.id, conversationId: message.conversationId, role: message.role === "user" ? "user" : "assistant", text: message.text, data: message.data, surface: message.surface, at: message.at, attachments: message.data?.attachments?.map((attachment) => ({ ...attachment, progress: 100 })), run };
          }));
          setMessages(hydrated);
        })
        .catch(() => setMessages([{ id: "welcome", role: "assistant", text: "Tell me what your startup needs: I can establish the strategy, plan the calendar, repurpose source material, or handle a one-off request in context." }]))
        .finally(() => setLoaded(true));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const run = chat.run;
    if (!run || run.status === "running" || completedRuns.current.has(run.runId)) return;
    completedRuns.current.add(run.runId);
    setMessages((current) => [...current, { id: `run-${run.runId}`, conversationId: submittedConversationId.current ?? undefined, role: "assistant", text: run.status === "complete" ? run.text : run.error ?? "Chat run failed", run, surface: "dashboard", at: new Date().toISOString() }]);
  }, [chat.run]);

  const sessions = useMemo(() => groupSessions(messages), [messages]);
  useEffect(() => {
    if (!loaded || conversationId || activeConversationId) return;
    const nextConversationId = sessions.at(-1)?.conversationId ?? crypto.randomUUID();
    setActiveConversationId(nextConversationId);
    router.replace(conversationPath(nextConversationId));
  }, [activeConversationId, conversationId, loaded, router, sessions]);

  const visibleMessages = useMemo(() => {
    if (!activeConversationId) return [];
    return sessions.find((session) => session.conversationId === activeConversationId)?.messages ?? [];
  }, [activeConversationId, sessions]);
  const activeJobId = activeJobIdForConversation(visibleMessages);

  const openJob = useCallback(async (jobId: string) => {
    detailRequest.current?.abort();
    const controller = new AbortController();
    detailRequest.current = controller;
    setDetailLoading(true);
    setDetailError(null);
    try {
      const bundle = await readJobDetail(jobId, controller.signal);
      if (!controller.signal.aborted) setDetail(bundle);
    } catch (error) {
      if (!controller.signal.aborted) setDetailError(error instanceof Error ? error.message : String(error));
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    if (activeJobId && detail?.job.id !== activeJobId) void openJob(activeJobId);
  }, [activeJobId, detail?.job.id, openJob]);

  useEffect(() => {
    const jobId = detail?.job.id;
    if (busy || detailLoading || !jobId || (activeJobId && jobId !== activeJobId) || !["running", "waiting_for_approval"].includes(detail.job.status)) return;
    return startJobRefresh(async (signal) => {
      const bundle = await readJobDetail(jobId, signal);
      if (!signal.aborted) { setDetail(bundle); setDetailError(null); }
    }, (error) => setDetailError(error instanceof Error ? error.message : String(error)));
  }, [activeJobId, detail?.job.id, detail?.job.status, busy, detailLoading]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams(window.location.search);
      const jobId = query.get("job");
      if (!jobId) return;
      void openJob(jobId);
      window.history.replaceState({}, "", window.location.pathname);
      if (query.get("item")) setInput("Refine the post from this job — make it punchier and suggest a better posting time.");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [openJob]);

  async function decide(jobId: string, actionId: string, decision: "approved" | "rejected") {
    setBusy(true);
    try {
      const payloadDigest = detail?.job.actions.find((action) => action.id === actionId)?.payloadDigest;
      if (!payloadDigest) throw new Error("Approval payload digest is unavailable; refresh the job before deciding.");
      const response = await apiFetch(`/api/jobs/${jobId}/actions/${actionId}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, payloadDigest }) });
      if (!response.ok) throw new Error(`Decision failed (${response.status})`);
      setMessages((current) => [...current, { id: `decision-${Date.now()}`, role: "assistant", text: `${decision === "approved" ? "Approved" : "Rejected"} action ${actionId} on job ${jobId}.`, surface: "dashboard", at: new Date().toISOString() }]);
      await openJob(jobId);
    } finally { setBusy(false); }
  }

  async function decideOperation(operationId: string, decision: "approved" | "rejected") {
    setBusy(true);
    try {
      const response = await apiFetch(`/api/chat/operations/${operationId}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision }) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Operation decision failed (${response.status})`);
      setMessages((current) => [...current, { id: `operation-${Date.now()}`, role: "assistant", text: `${decision === "approved" ? "Approved" : "Rejected"} operation ${operationId}.`, surface: "dashboard", at: new Date().toISOString() }]);
    } finally { setBusy(false); }
  }

  async function sealProductionPlan(planId: string, planDigest: string) {
    setBusy(true);
    try {
      const response = await apiFetch(`/api/production-plans/${planId}/seal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ planDigest }) });
      const body = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(body?.error ?? `Production plan sealing failed (${response.status})`);
      if (detail?.job.id) await openJob(detail.job.id);
    } finally { setBusy(false); }
  }

  async function decideProductionPlan(planId: string, planDigest: string, decision: "approved" | "rejected", feedback?: string) {
    setBusy(true);
    try {
      const body = decision === "approved"
        ? { decision, planDigest, expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() }
        : { decision, planDigest, feedback };
      const response = await apiFetch(`/api/production-plans/${planId}/decision`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(result?.error ?? `Production plan decision failed (${response.status})`);
      if (detail?.job.id) await openJob(detail.job.id);
    } finally { setBusy(false); }
  }

  async function send(messageText?: string) {
    const message = (messageText ?? input).trim();
    if (!message || busy || attachments.some((attachment) => attachment.state !== "ready")) return;
    const submittedAttachments = attachments;
    const targetConversationId = activeConversationId ?? crypto.randomUUID();
    if (!activeConversationId) {
      setActiveConversationId(targetConversationId);
      router.replace(conversationPath(targetConversationId));
    }
    submittedConversationId.current = targetConversationId;
    setInput(""); setAttachments([]); setBusy(true);
    setMessages((current) => [...current, { id: `operator-${Date.now()}`, conversationId: targetConversationId, role: "user", text: message, attachments: submittedAttachments, surface: "dashboard", at: new Date().toISOString() }]);
    try {
      const result = await chat.send(message, submittedAttachments.map((attachment) => attachment.attachmentId), targetConversationId);
      const latestJobId = result.jobUpdates.at(-1)?.jobId;
      if (latestJobId) await openJob(latestJobId);
    } catch (error) {
      setMessages((current) => [...current, { id: `failure-${Date.now()}`, conversationId: targetConversationId, role: "assistant", text: error instanceof Error ? error.message : String(error), surface: "dashboard", at: new Date().toISOString() }]);
    } finally { setBusy(false); }
  }

  function beginNewConversation() {
    const nextConversationId = crypto.randomUUID();
    setActiveConversationId(nextConversationId);
    submittedConversationId.current = nextConversationId;
    router.push(conversationPath(nextConversationId));
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
    setSelectedArtifactId(null);
    setMobilePane("conversation");
    setInput("");
    setAttachments([]);
    setHistoryOpen(false);
  }

  async function retryJob() {
    const job = detail?.job;
    const failure = job?.failure;
    if (!job || !failure) return;
    const response = await apiFetch(`/api/jobs/${job.id}/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(failure.retryable ? {} : { afterFix: true }),
    });
    const body = await response.json().catch(() => null) as { error?: string } | null;
    if (!response.ok) throw new Error(body?.error ?? `Retry failed (${response.status})`);
    await openJob(job.id);
  }

  const historyAccessory = <div className="flex shrink-0 items-center gap-2"><button type="button" onClick={beginNewConversation} className="flex h-8 items-center rounded-full border border-black/15 bg-[#d9ff43] px-3 text-[10px] font-bold uppercase tracking-[0.12em] transition hover:bg-[#c6ee32]" aria-label="Start a new conversation">+ New</button><button type="button" onClick={() => setHistoryOpen((open) => !open)} aria-expanded={historyOpen} aria-controls="past-conversations" className="flex h-8 items-center gap-1 rounded-full border border-black/15 bg-white px-3 text-[10px] font-bold uppercase tracking-[0.12em] transition hover:bg-[#d9ff43]" aria-label="Toggle past conversations">Past chats <span aria-hidden="true">☰</span></button></div>;
  const historyDrawer = historyOpen ? <>
    <button type="button" aria-label="Close past conversations" className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]" onClick={() => setHistoryOpen(false)} />
    <aside id="past-conversations" aria-label="Past conversations" className="fixed inset-y-3 right-3 z-50 flex w-[min(360px,calc(100vw-24px))] flex-col overflow-hidden rounded-[24px] border border-black/10 bg-[#f4f0e8] shadow-2xl">
      <header className="flex items-center gap-3 border-b border-black/10 px-5 py-4"><div><p className="font-mono text-[8px] uppercase tracking-[0.16em] text-[#77736b]">Conversation archive</p><h2 className="text-lg font-extrabold tracking-tight">Past conversations</h2></div><button type="button" onClick={() => setHistoryOpen(false)} className="ml-auto grid h-8 w-8 place-items-center rounded-full bg-[#ded8ce] text-lg" aria-label="Close">×</button></header>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{[...sessions].reverse().map((session) => { const current = activeConversationId === session.conversationId; return <button key={session.id} type="button" onClick={() => { setActiveConversationId(session.conversationId); submittedConversationId.current = session.conversationId; router.push(conversationPath(session.conversationId)); setHistoryOpen(false); }} className={`mb-2 w-full rounded-[16px] border p-3 text-left transition ${current ? "border-[#11110f] bg-[#d9ff43]" : "border-black/10 bg-white/65 hover:bg-white"}`}><div className="flex items-center gap-2 font-mono text-[8px] uppercase tracking-[0.1em] text-[#68645d]"><span>{dayLabel(session.day)}</span><span className="ml-auto">{session.messages.length} turns</span></div><p className="mt-2 line-clamp-2 text-sm font-bold leading-snug">{sessionPreview(session) || "Untitled conversation"}</p><p className="mt-1 text-[10px] text-[#77736b]">{session.surface === "telegram" ? "Telegram" : "Studio"}</p></button>; })}</div>
    </aside>
  </> : null;

  return <StudioConsoleView messages={visibleMessages} loaded={loaded} detail={detail} detailLoading={detailLoading} detailError={detailError} liveRun={chat.run?.status === "running" ? chat.run : null} input={input} onInputChange={setInput} attachments={attachments} onAttachmentsChange={setAttachments} busy={busy} onSend={send} onOpenJob={openJob} selectedArtifactId={selectedArtifactId} onSelectedArtifactChange={setSelectedArtifactId} mobilePane={mobilePane} onMobilePaneChange={setMobilePane} onDecide={decide} onOperationDecision={decideOperation} onSealProductionPlan={sealProductionPlan} onDecideProductionPlan={decideProductionPlan} onRetryJob={detail?.job.failure ? retryJob : undefined} historyAccessory={historyAccessory} historyDrawer={historyDrawer} />;
}
