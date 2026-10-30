"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/clientApi";
import type { ChatResponse } from "@/app/api/chat/route";
import { contentArtifactPreview } from "@/lib/contentArtifacts/presentation";
import { AttachmentCard, ConfirmationCard, MessageContent } from "@/components/a2ui/HarmoniaElements";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  data?: ChatResponse;
}

const STAGE_COLORS: Record<string, string> = {
  complete: "border-emerald-400 text-emerald-600 dark:text-emerald-400",
  failed: "border-red-400 text-red-600 dark:text-red-400",
  awaiting_approval: "border-amber-400 text-amber-600 dark:text-amber-400",
};

function JobCardView({ job }: { job: NonNullable<ChatResponse["job"]> }) {
  const color = STAGE_COLORS[job.stage] ?? "border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400";
  return (
    <div className={`rounded-lg border px-3 py-2 text-xs ${color}`}>
      <div className="font-mono">{job.id}</div>
      <div className="mt-0.5 flex items-center gap-2">
        <span className="rounded border px-1.5 py-0.5 font-medium uppercase tracking-wide">{job.stage}</span>
        <span>{job.status}</span>
      </div>
      {job.title && <div className="mt-1 truncate opacity-80">{job.title}</div>}
    </div>
  );
}

export interface AskAiContext {
  kind: "job" | "content_item" | "proposal";
  id: string;
  label: string;
}

/** Fires the global "open chat with this item" event any surface can use. */
export function askAiAbout(context: AskAiContext) {
  window.dispatchEvent(new CustomEvent("harmonia:askai", { detail: context }));
}

const CONTEXT_LABEL: Record<AskAiContext["kind"], string> = {
  job: "Job",
  content_item: "Content item",
  proposal: "Proposal",
};

export default function ChatDrawer({ onJobCreated }: { onJobCreated?: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [context, setContext] = useState<AskAiContext | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      text: 'Tell me the outcome you need—build a strategy, plan next month, repurpose a source, make a one-off announcement, or check what needs approval.',
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onAskAi(e: Event) {
      const detail = (e as CustomEvent<AskAiContext>).detail;
      if (!detail?.id) return;
      setContext(detail);
      setMessages((m) => [
        ...m,
        { role: "assistant", text: `Context set: ${CONTEXT_LABEL[detail.kind]} "${detail.label}". Ask me anything about it.` },
      ]);
      setOpen(true);
    }
    window.addEventListener("harmonia:askai", onAskAi);
    return () => window.removeEventListener("harmonia:askai", onAskAi);
  }, []);

  useEffect(() => {
    if (open) scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, open]);

  async function decide(jobId: string, actionId: string, payloadDigest: string, decision: "approved" | "rejected", operationId?: string) {
    await apiFetch(operationId
      ? `/api/chat/operations/${operationId}/decision`
      : `/api/jobs/${jobId}/actions/${actionId}/decision`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(operationId ? { decision } : { decision, payloadDigest }),
    });
    setMessages((m) => [
      ...m,
      { role: "assistant", text: `${decision === "approved" ? "Approved" : "Rejected"} action ${actionId} on job ${jobId}.` },
    ]);
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    const requestId = crypto.randomUUID();
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text: context ? `[${CONTEXT_LABEL[context.kind]}] ${message}` : message }]);
    try {
      const res = await apiFetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message,
          surface: "dashboard",
          requestId,
          ...(context ? { context: { kind: context.kind, id: context.id } } : {}),
        }),
      });
      const data = (await res.json().catch(() => null)) as (ChatResponse & { error?: string }) | null;
      if (!res.ok || !data) {
        setMessages((m) => [...m, { role: "assistant", text: data?.error ?? `chat failed (${res.status})` }]);
      } else {
        setMessages((m) => [...m, { role: "assistant", text: data.reply, data }]);
        if (data.intent === "create_job" && data.jobId) onJobCreated?.(data.jobId);
      }
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", text: e instanceof Error ? e.message : String(e) }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open operator chat"
          className="fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full bg-zinc-800 text-white shadow-lg hover:bg-zinc-600 dark:bg-zinc-200 dark:text-black"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </button>
      )}
      {open && (
        <div className="fixed bottom-5 right-5 z-40 flex h-[480px] w-[360px] max-w-[calc(100vw-2.5rem)] flex-col overflow-hidden rounded-xl border border-zinc-300 bg-white shadow-xl dark:border-zinc-700 dark:bg-zinc-950">
          <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
            <span className="text-xs font-semibold uppercase tracking-wide">Operator chat</span>
            <button onClick={() => setOpen(false)} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200" aria-label="Close chat">✕</button>
          </div>
          {context && (
            <div className="flex items-center gap-2 border-b border-violet-200 bg-violet-50 px-3 py-1.5 dark:border-violet-900 dark:bg-violet-950/40">
              <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-white">
                {CONTEXT_LABEL[context.kind]}
              </span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-violet-800 dark:text-violet-200">{context.label}</span>
              <button onClick={() => setContext(null)} className="text-violet-400 hover:text-violet-600" aria-label="Clear context">✕</button>
            </div>
          )}
          <div ref={scrollRef} className="flex flex-1 flex-col gap-2 overflow-y-auto px-3 py-2">
            {messages.map((m, i) => (
              <div key={i} className={m.role === "user" ? "self-end" : "self-start"}>
                <div className={`max-w-[280px] whitespace-pre-wrap rounded-lg px-3 py-1.5 text-xs leading-5 ${
                  m.role === "user"
                    ? "bg-zinc-800 text-white dark:bg-zinc-200 dark:text-black"
                    : "bg-zinc-100 text-zinc-800 dark:bg-zinc-900 dark:text-zinc-200"
                }`}>
                  <MessageContent text={m.text} />
                </div>
                {m.data && (
                  <div className="mt-1 flex max-w-[280px] flex-col gap-1">
                    {m.data.assets?.map((asset) => (
                      <AttachmentCard key={asset.actionId} attachment={{
                        attachmentId: asset.actionId,
                        filename: asset.actionId,
                        mime: asset.mime,
                        sizeBytes: 0,
                        state: "ready",
                        previewUrl: `/api/jobs/${m.data!.jobId ?? m.data!.job?.id}/assets/${asset.actionId}`,
                      }} />
                    ))}
                    {m.data.job && <JobCardView job={m.data.job} />}
                    {m.data.jobs?.map((j) => <JobCardView key={j.id} job={j} />)}
                    {m.data.artifacts?.map((artifact) => (
                      <div key={artifact.id} className="rounded-lg border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800">
                        <div className="mb-1 font-medium uppercase tracking-wide text-zinc-400">{artifact.outputType.replaceAll("_", " ")} · revision {artifact.revision}</div>
                        {contentArtifactPreview(artifact)}
                        <div className="mt-1 truncate font-mono text-[9px] text-zinc-400">{artifact.contentDigest}</div>
                      </div>
                    ))}
                    {m.data.pendingActions && m.data.job && m.data.pendingActions.map((a) => (
                      <ConfirmationCard
                        key={a.id}
                        title={a.title}
                        description={`${a.type} · action ${a.id}`}
                        risk={a.risk === "high" ? "high" : a.risk === "low" ? "low" : "material"}
                        state="pending"
                        onDecision={(decision) => decide(
                          m.data!.job!.id,
                          a.id,
                          a.payloadDigest,
                          decision,
                          m.data!.pendingActions?.[0]?.id === a.id ? m.data!.confirmation?.operationId : undefined,
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="self-start text-xs text-zinc-400">thinking…</div>}
          </div>
          <div className="flex gap-1.5 border-t border-zinc-200 p-2 dark:border-zinc-800">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void send()}
              placeholder="What do you want Harmonia to accomplish?"
              className="w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-xs outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              onClick={() => void send()}
              disabled={busy}
              className="shrink-0 rounded-md bg-zinc-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-600 disabled:opacity-50 dark:bg-zinc-200 dark:text-black"
            >
              Send
            </button>
          </div>
        </div>
      )}
    </>
  );
}
