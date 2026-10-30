import type { ReactNode } from "react";
import Image from "next/image";

export type ElementStatus = "pending" | "active" | "complete" | "failed";

const STATUS_STYLE: Record<ElementStatus, string> = {
  pending: "border-zinc-300 bg-zinc-100 text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900",
  active: "border-sky-400 bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  complete: "border-emerald-400 bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "border-red-400 bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300",
};

export function StatusPill({ status }: { status: ElementStatus }) {
  return <span className={`rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${STATUS_STYLE[status]}`}>{status}</span>;
}

export interface ActivityStep {
  id: string;
  label: string;
  description?: string;
  status: ElementStatus;
}

export function ActivityTrace({ title, steps }: { title: string; steps: ActivityStep[] }) {
  return (
    <details className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-950" open={steps.some((step) => step.status === "active")}>
      <summary className="cursor-pointer text-xs font-semibold text-zinc-700 dark:text-zinc-200">{title}</summary>
      <ol className="mt-3 space-y-2 border-l border-zinc-200 pl-3 dark:border-zinc-800">
        {steps.map((step) => (
          <li key={step.id} className="text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="font-medium text-zinc-700 dark:text-zinc-200">{step.label}</span>
              <StatusPill status={step.status} />
            </div>
            {step.description && <p className="mt-1 leading-5 text-zinc-500">{step.description}</p>}
          </li>
        ))}
      </ol>
    </details>
  );
}

export function ReasoningSummary({ summary, sources }: { summary: string; sources?: ReactNode }) {
  return (
    <details className="rounded-xl border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <summary className="cursor-pointer text-xs font-medium text-zinc-500">Reasoning summary</summary>
      <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-zinc-700 dark:text-zinc-300">{summary}</p>
      {sources && <div className="mt-2">{sources}</div>}
    </details>
  );
}

export function InlineCitation({ title, url, sourceId, excerpt }: { title: string; url: string; sourceId?: string; excerpt?: string }) {
  return (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex max-w-full items-center gap-1 rounded-full border border-zinc-200 px-2 py-0.5 text-[11px] text-zinc-600 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-300" title={excerpt}>
      <span className="truncate">{title}</span>
      {sourceId && <span className="font-mono text-zinc-400">[{sourceId}]</span>}
    </a>
  );
}

export function ContextUsage({ model, inputTokens, outputTokens, contextLimit, cachedTokens, estimatedCostUsd }: { model: string; inputTokens: number; outputTokens: number; contextLimit?: number; cachedTokens?: number; estimatedCostUsd?: number }) {
  const total = inputTokens + outputTokens;
  const percent = contextLimit ? Math.min(100, (total / contextLimit) * 100) : null;
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3 text-xs dark:border-zinc-800 dark:bg-zinc-950">
      <div className="flex items-center justify-between gap-2"><span className="font-medium">Context</span><span className="font-mono text-zinc-500">{model}</span></div>
      {percent !== null && <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900"><div className="h-full bg-sky-500" style={{ width: `${percent}%` }} /></div>}
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-zinc-500">
        <span>{total.toLocaleString()}{contextLimit ? ` / ${contextLimit.toLocaleString()}` : ""} tokens</span>
        {percent !== null && <span>{percent.toFixed(1)}%</span>}
        {cachedTokens !== undefined && <span>{cachedTokens.toLocaleString()} cached</span>}
        {estimatedCostUsd !== undefined && <span>${estimatedCostUsd.toFixed(4)}</span>}
      </div>
    </div>
  );
}

export interface AttachmentView {
  attachmentId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  state: "uploading" | "quarantined" | "scanning" | "ready" | "rejected" | "failed";
  previewUrl?: string;
}

export function AttachmentCard({ attachment, onRemove }: { attachment: AttachmentView; onRemove?: () => void }) {
  const isImage = attachment.mime.startsWith("image/");
  const isVideo = attachment.mime.startsWith("video/");
  const isAudio = attachment.mime.startsWith("audio/");
  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
      {attachment.previewUrl && isImage && <Image unoptimized width={640} height={280} src={attachment.previewUrl} alt={attachment.filename} className="h-28 w-full object-cover" />}
      {attachment.previewUrl && isVideo && <video src={attachment.previewUrl} controls className="h-32 w-full bg-black object-contain" />}
      {attachment.previewUrl && isAudio && <audio src={attachment.previewUrl} controls className="w-full p-2" />}
      <div className="flex items-center gap-2 p-2 text-xs">
        <div className="min-w-0 flex-1"><div className="truncate font-medium">{attachment.filename}</div><div className="text-[10px] text-zinc-400">{attachment.mime} · {(attachment.sizeBytes / 1_048_576).toFixed(1)} MB</div></div>
        <span className="text-[10px] uppercase text-zinc-400">{attachment.state}</span>
        {onRemove && <button type="button" onClick={onRemove} aria-label={`Remove ${attachment.filename}`} className="text-zinc-400 hover:text-red-500">✕</button>}
      </div>
    </div>
  );
}

export function PlanView({ title, steps }: { title: string; steps: ActivityStep[] }) {
  return <ActivityTrace title={title} steps={steps} />;
}

export function QueueView({ title, items }: { title: string; items: Array<ActivityStep & { jobId?: string }> }) {
  return (
    <div className="rounded-xl border border-zinc-200 p-3 dark:border-zinc-800"><h3 className="text-xs font-semibold">{title}</h3><div className="mt-2 space-y-1.5">{items.map((item) => <div key={item.id} className="flex items-center gap-2 rounded-lg bg-zinc-50 px-2 py-1.5 text-xs dark:bg-zinc-900"><span className="min-w-0 flex-1 truncate">{item.label}</span>{item.jobId && <span className="font-mono text-[10px] text-zinc-400">{item.jobId}</span>}<StatusPill status={item.status} /></div>)}</div></div>
  );
}

export function ToolActivity({ name, status, inputSummary, outputSummary, durationMs, traceId }: { name: string; status: ElementStatus; inputSummary?: string; outputSummary?: string; durationMs?: number; traceId?: string }) {
  return (
    <details className="rounded-xl border border-zinc-200 p-3 text-xs dark:border-zinc-800">
      <summary className="cursor-pointer"><span className="font-mono">{name}</span> <StatusPill status={status} /></summary>
      <div className="mt-2 space-y-1 text-zinc-500">{inputSummary && <p><span className="font-medium">Input:</span> {inputSummary}</p>}{outputSummary && <p><span className="font-medium">Output:</span> {outputSummary}</p>}<div className="flex gap-3 text-[10px]">{durationMs !== undefined && <span>{durationMs} ms</span>}{traceId && <span className="font-mono">trace {traceId}</span>}</div></div>
    </details>
  );
}

export function TaskView({ title, owner, status, jobId, stage }: { title: string; owner?: string; status: ElementStatus; jobId?: string; stage?: string }) {
  return <div className="flex items-center gap-2 rounded-xl border border-zinc-200 px-3 py-2 text-xs dark:border-zinc-800"><span className="min-w-0 flex-1"><span className="font-medium">{title}</span>{owner && <span className="ml-2 text-zinc-400">{owner}</span>}</span>{jobId && <span className="font-mono text-[10px] text-zinc-400">{jobId}{stage ? `/${stage}` : ""}</span>}<StatusPill status={status} /></div>;
}

export function ConfirmationCard({ title, description, risk, state, disabled, onDecision }: { title: string; description?: string; risk: "low" | "material" | "high"; state: "pending" | "approved" | "rejected" | "expired"; disabled?: boolean; onDecision?: (decision: "approved" | "rejected") => void }) {
  return (
    <div className="border border-black/15 bg-[#fffdf7] p-4 text-xs"><div className="flex items-start justify-between gap-3"><div><span className="mb-1 block text-[9px] font-black uppercase tracking-[0.16em] text-[#ff5c35]">Approval checkpoint</span><strong className="font-serif text-lg">{title}</strong></div><span className="bg-[#ff5c35] px-2 py-1 text-[9px] font-black uppercase tracking-wider text-white">{risk} risk</span></div>{description && <p className="mt-2 max-w-2xl leading-5 text-black/60">{description}</p>}{state === "pending" && onDecision ? <div className="mt-4 flex gap-2"><button type="button" disabled={disabled} onClick={() => onDecision("approved")} className="rounded-full bg-[#161512] px-5 py-2 font-black uppercase tracking-wider text-white shadow-[3px_3px_0_#d9ff43] disabled:opacity-50">Approve</button><button type="button" disabled={disabled} onClick={() => onDecision("rejected")} className="rounded-full border-2 border-[#161512] px-5 py-1.5 font-black uppercase tracking-wider text-[#161512] disabled:opacity-50">Reject</button></div> : <p className="mt-2 font-bold capitalize">{state}</p>}</div>
  );
}

export function MessageContent({ text, children }: { text: string; children?: ReactNode }) {
  return <div><div className="whitespace-pre-wrap text-sm leading-6">{text}</div>{children && <div className="mt-2 flex flex-col gap-2">{children}</div>}</div>;
}
