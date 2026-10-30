"use client";

import { useEffect } from "react";
import type { JobFull, Receipt } from "@/components/jobTypes";
import type { TimelineEvent } from "@/components/Timeline";
import { JobExecutionProof } from "./JobExecutionProof";

export function ProofDrawer({ open, job, events, receipts, onClose }: { open: boolean; job: JobFull; events: TimelineEvent[]; receipts: Receipt[]; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  return <>
    {open ? <button type="button" aria-label="Close proof and audit trail" onClick={onClose} className="absolute inset-0 z-30 cursor-default bg-black/25 backdrop-blur-[1px]" /> : null}
    <aside role="dialog" aria-modal="true" aria-label="Proof and audit trail" aria-hidden={!open} inert={!open} className={`absolute inset-y-0 right-0 z-40 flex w-full max-w-[42rem] flex-col border-l border-black/15 bg-[#f7f4ed] shadow-[-18px_0_45px_rgba(17,17,15,.18)] transition duration-200 motion-reduce:transition-none ${open ? "translate-x-0 opacity-100" : "pointer-events-none translate-x-full opacity-0"}`}>
      <header className="flex min-h-[72px] items-center gap-3 border-b border-black/10 px-5"><div><p className="text-xs font-black uppercase tracking-[0.12em] text-[#3157ff]">Proof layer</p><h2 className="text-lg font-extrabold">Audit trail</h2></div><button type="button" onClick={onClose} className="ml-auto min-h-10 rounded-full border border-black/20 px-4 text-xs font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3157ff]">Close</button></header>
      <div className="flex-1 overflow-y-auto p-5"><p className="mb-4 text-sm leading-6 text-black/55">Persisted authority, receipts, verification, and execution history. These records explain what happened without crowding the content workspace.</p><JobExecutionProof job={job} events={events} receipts={receipts} initiallyOpen />{events.length ? <section className="mt-5 border-t border-black/15 pt-4" aria-labelledby="proof-events-heading"><h3 id="proof-events-heading" className="text-xs font-black uppercase tracking-[0.12em] text-black/45">Execution timeline · {events.length} events</h3><ol className="mt-3 space-y-3">{[...events].reverse().map((event, index) => <li key={`${event.at}-${index}`} className="grid grid-cols-[5rem_1fr] gap-3 text-sm"><time className="font-mono text-xs text-black/40">{event.at ? new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</time><span>{event.message}</span></li>)}</ol></section> : null}</div>
    </aside>
  </>;
}
