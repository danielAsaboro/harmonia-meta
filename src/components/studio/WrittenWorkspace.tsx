"use client";

import { useState } from "react";
import type { JobFull } from "@/components/jobTypes";
import type { ContentArtifact } from "@/lib/contentArtifacts/contracts";
import type { TraceLink } from "@/lib/studio/workspaceModel";
import { StudioEmpty } from "./StudioStates";
import { contentArtifactPreview } from "@/lib/contentArtifacts/presentation";

export function platformPreviewLabel(outputType: string): string {
  const labels: Record<string, string> = { x_post: "X post preview", x_thread: "X thread preview", linkedin_post: "LinkedIn post preview", newsletter: "Newsletter preview", blog_article: "Article preview", caption: "Caption preview" };
  return labels[outputType] ?? "Content preview";
}

export function artifactRevisionRequest(jobId: string, artifactId: string, editedDraft: string): string {
  return `Revise artifact ${artifactId} for job ${jobId}. Use this operator-edited draft as direction, preserve source grounding, and create a new reviewed revision without changing the accepted artifact in place:\n\n${editedDraft.trim()}`;
}

export function WrittenWorkspace({ job, traceLinks, selectedArtifactId, onSelect, onRequestRevision }: { job: JobFull; traceLinks: TraceLink[]; selectedArtifactId: string | null; onSelect: (artifactId: string) => void; onRequestRevision?: (message: string) => Promise<void> | void }) {
  const artifacts = job.contentArtifacts ?? [];
  if (!artifacts.length) return <StudioEmpty title="No reviewed content yet">Accepted immutable artifacts appear here after production and review.</StudioEmpty>;
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      {artifacts.map((artifact, index) => {
        const artifactId = `artifact:${artifact.id}`;
        const trace = traceLinks.find((candidate) => candidate.artifactId === artifact.id);
        const exportAction = job.actions.find((action) => action.type === "export_content_artifact" && action.payload.artifactId === artifact.id);
        const verification = job.verifications?.find((item) => item.actionId === exportAction?.id);
        return <WrittenArtifactCard key={artifact.id} jobId={job.id} artifact={artifact} index={index} artifactId={artifactId} selected={selectedArtifactId === artifactId} status={verification?.verified ? "Verified" : exportAction?.state ?? "Accepted"} traceError={trace && !trace.valid ? trace.error : undefined} onSelect={onSelect} onRequestRevision={onRequestRevision} />;
      })}
    </div>
  );
}

function WrittenArtifactCard({ jobId, artifact, index, artifactId, selected, status, traceError, onSelect, onRequestRevision }: { jobId: string; artifact: ContentArtifact; index: number; artifactId: string; selected: boolean; status: string; traceError?: string; onSelect: (artifactId: string) => void; onRequestRevision?: (message: string) => Promise<void> | void }) {
  const preview = contentArtifactPreview(artifact);
  const [draft, setDraft] = useState(preview);
  const [copied, setCopied] = useState(false);
  const [sending, setSending] = useState(false);
  return <article tabIndex={-1} data-canvas-artifact={artifactId} onClick={() => onSelect(artifactId)} className={`group relative min-h-72 border-2 bg-[#fffdf7] p-5 transition ${selected ? "border-[#ff5c35] shadow-[8px_8px_0_#ff5c35]" : "border-black/15 hover:border-black/50"}`}>
    <div className="flex items-start justify-between gap-3"><div><span className="font-mono text-xs text-[#ff5c35]">0{index + 1}</span><h3 className="mt-2 font-serif text-2xl">{artifact.title}</h3><p className="mt-1 text-xs font-bold uppercase tracking-[0.08em] text-black/45">{platformPreviewLabel(artifact.outputType)} · revision {artifact.revision}</p></div><span className={`px-2 py-1 text-xs font-black uppercase tracking-[0.1em] ${status === "Verified" ? "bg-[#d9ff43] text-[#283600]" : "bg-[#e8e4dc] text-[#625e56]"}`}>{status}</span></div>
    <section aria-label={platformPreviewLabel(artifact.outputType)} className={`mt-5 rounded-[16px] border bg-white p-4 ${artifact.outputType === "linkedin_post" ? "border-[#0a66c2]/30" : "border-black/10"}`}><div className="mb-3 flex items-center gap-2"><span className={`grid h-9 w-9 place-items-center rounded-full text-xs font-black text-white ${artifact.outputType === "linkedin_post" ? "bg-[#0a66c2]" : "bg-black"}`}>H</span><div><b className="block text-sm">Harmonia</b><span className="text-xs text-black/40">Prepared content · Preview</span></div></div><p className="whitespace-pre-wrap text-[15px] leading-7 text-[#24211d]">{preview}</p></section>
    <div className="mt-4 flex flex-wrap items-center gap-2"><button type="button" onClick={(event) => { event.stopPropagation(); void navigator.clipboard.writeText(preview).then(() => setCopied(true)); }} className="min-h-10 rounded-full border border-black/20 px-4 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3157ff]">{copied ? "Copied" : "Copy"}</button>{onRequestRevision ? <details className="min-w-[15rem] flex-1" onClick={(event) => event.stopPropagation()}><summary className="inline-flex min-h-10 cursor-pointer items-center rounded-full bg-black px-4 text-xs font-bold text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3157ff]">Edit & request revision</summary><div className="mt-3 rounded-xl border border-black/15 bg-[#f4f0e8] p-3"><label className="text-xs font-bold" htmlFor={`revision-${artifact.id}`}>Edited direction</label><textarea id={`revision-${artifact.id}`} value={draft} onChange={(event) => setDraft(event.target.value)} rows={8} maxLength={12000} className="mt-2 w-full rounded-lg border border-black/20 bg-white p-3 text-sm leading-6 focus-visible:outline-2 focus-visible:outline-[#3157ff]"/><p className="mt-2 text-xs text-black/50">Submitting creates a new grounded revision. The accepted artifact stays unchanged.</p><button type="button" disabled={sending || !draft.trim() || draft.trim() === preview.trim()} onClick={async () => { if (!onRequestRevision) return; setSending(true); try { await onRequestRevision(artifactRevisionRequest(jobId, artifact.id, draft)); } finally { setSending(false); } }} className="mt-3 min-h-10 rounded-full bg-[#3157ff] px-4 text-xs font-bold text-white disabled:opacity-40">{sending ? "Sending…" : "Send revision request"}</button></div></details> : null}</div>
    <div className="mt-5 border-t border-black/10 pt-3 text-xs text-black/45"><span>{artifact.sourceSegmentRefs.length} source reference{artifact.sourceSegmentRefs.length === 1 ? "" : "s"}</span>{traceError ? <p role="alert" className="mt-2 font-bold text-red-700">Trace error: {traceError}</p> : null}<details className="mt-2"><summary className="cursor-pointer font-bold">Provenance</summary><code className="mt-1 block break-all text-[10px]">Content digest {artifact.contentDigest}</code></details></div>
  </article>;
}
