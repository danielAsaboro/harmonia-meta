"use client";

import { useState, type ReactNode } from "react";

export function StudioEmpty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid min-h-64 place-items-center border border-dashed border-black/20 bg-white/40 p-8 text-center">
      <div className="max-w-sm"><p className="font-serif text-2xl">{title}</p><div className="mt-2 text-sm text-black/55">{children}</div></div>
    </section>
  );
}

export function StudioLoading({ label = "Loading the working set" }: { label?: string }) {
  return <div role="status" className="animate-pulse border border-black/10 bg-white/55 p-5 text-sm font-semibold text-black/55">{label}…</div>;
}

export function StudioFailure({ message, permanent, onRetry, onRetryAfterFix, details }: { message: string; permanent?: boolean; onRetry?: () => void | Promise<void>; onRetryAfterFix?: () => void | Promise<void>; details?: Record<string, string | number | boolean> }) {
  const historicalRecord = message.includes("erased by retention");
  const contractDetails = details ? Object.entries(details).filter(([, value]) => value !== "" && value !== undefined).map(([key, value]) => `${key.replaceAll(/([A-Z])/g, " $1").toLowerCase()}: ${String(value)}`) : [];
  const [retryError, setRetryError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  async function retry(action: () => void | Promise<void>) {
    setRetrying(true);
    setRetryError(null);
    try {
      await action();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : String(error));
    } finally {
      setRetrying(false);
    }
  }
  return (
    <section role="alert" className="border-2 border-[#ff5c35] bg-[#fff1eb] p-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-[#9f2c11]">{historicalRecord ? "Historical record" : permanent ? "Harmonia needs a correction" : "Work paused"}</p>
      <p className="mt-2 text-sm leading-6 text-[#4b1a0e]">{message}</p>
      {permanent && !historicalRecord ? <p className="mt-3 text-xs font-semibold text-[#7e2b16]">Harmonia needs a correction before this job can continue. Your saved work will not be discarded or retried automatically.</p> : null}
      {contractDetails.length ? <details className="mt-3 border-t border-[#d9947f] pt-2"><summary className="cursor-pointer text-xs font-bold text-[#7e2b16]">Technical details</summary><dl className="mt-2 grid gap-1 font-mono text-[10px] text-[#7e2b16]">{contractDetails.map((detail) => <div key={detail}>{detail}</div>)}</dl></details> : null}
      {onRetry && !permanent ? <button type="button" disabled={retrying} onClick={() => void retry(onRetry)} className="mt-3 bg-[#161512] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{retrying ? "Retrying…" : "Retry"}</button> : null}
      {onRetryAfterFix && permanent && !historicalRecord ? <button type="button" disabled={retrying} onClick={() => void retry(onRetryAfterFix)} className="mt-3 bg-[#161512] px-4 py-2 text-sm font-bold text-white disabled:opacity-50">{retrying ? "Continuing…" : "Continue after correction"}</button> : null}
      {retryError ? <p className="mt-2 text-xs font-semibold text-[#9f2c11]">{retryError}</p> : null}
    </section>
  );
}
