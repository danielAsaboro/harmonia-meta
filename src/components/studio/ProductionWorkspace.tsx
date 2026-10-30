"use client";

import { useState } from "react";
import type { JobFull } from "@/components/jobTypes";

interface ProductionWorkspaceProps {
  job: JobFull;
  busy?: boolean;
  onSeal?: (planId: string, planDigest: string) => Promise<void> | void;
  onDecide?: (planId: string, planDigest: string, decision: "approved" | "rejected", feedback?: string) => Promise<void> | void;
}

export function ProductionWorkspace({ job, busy = false, onSeal, onDecide }: ProductionWorkspaceProps) {
  const workspace = job.productionPlan;
  const [feedback, setFeedback] = useState("");
  if (!workspace) return null;
  const { aggregate, revision, operations } = workspace;
  const plan = revision.plan;
  const succeeded = operations.filter((operation) => operation.state === "succeeded").length;
  const failed = operations.filter((operation) => operation.state === "failed" || operation.state === "uncertain").length;
  return (
    <section id="production-plan-review" className="mb-5 rounded-[18px] border border-black/10 bg-white p-4" aria-label="Media production plan">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <p className="font-mono text-[7px] uppercase tracking-[0.14em] text-black/45">Sealed autonomous media engine</p>
          <h2 className="mt-1 text-xl font-extrabold tracking-[-0.035em]">{plan.goal}</h2>
          <p className="mt-1 text-xs text-black/55">{plan.audience} · {plan.target.platform} · {plan.target.aspectRatio} · {plan.target.durationSec}s · {plan.target.resolution}</p>
        </div>
        <span className="ml-auto rounded-full bg-[#11110f] px-3 py-1.5 font-mono text-[8px] uppercase text-white">{aggregate.state}</span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-4">
        <div className="rounded-xl bg-[#f3f0e8] p-3"><span className="font-mono text-[7px] uppercase text-black/40">Maximum cost</span><b className="mt-1 block text-sm">${plan.maximumCostUsd}</b></div>
        <div className="rounded-xl bg-[#f3f0e8] p-3"><span className="font-mono text-[7px] uppercase text-black/40">Revision</span><b className="mt-1 block text-sm">v{revision.revision}</b></div>
        <div className="rounded-xl bg-[#f3f0e8] p-3"><span className="font-mono text-[7px] uppercase text-black/40">Progress</span><b className="mt-1 block text-sm">{succeeded}/{operations.length}</b></div>
        <div className="rounded-xl bg-[#f3f0e8] p-3"><span className="font-mono text-[7px] uppercase text-black/40">Failures</span><b className={`mt-1 block text-sm ${failed ? "text-red-700" : ""}`}>{failed}</b></div>
      </div>
      <details className="mt-3 rounded-xl border border-black/10 p-3">
        <summary className="cursor-pointer text-xs font-bold">Storyboard, model rationale, and operation graph</summary>
        <ol className="mt-3 space-y-2">
          {plan.scenes.map((scene) => <li key={scene.id} className="rounded-lg bg-[#f3f0e8] p-2 text-xs"><b>{scene.order}. {scene.purpose}</b><span className="ml-2 font-mono text-[8px] text-black/45">{scene.startSec}s–{scene.startSec + scene.durationSec}s · {scene.video?.modelCapability ?? "source"}</span></li>)}
        </ol>
        {plan.soundtrack ? <p className="mt-3 text-xs"><b>Soundtrack:</b> {plan.soundtrack.modelCapability} · {plan.soundtrack.prompt}</p> : <p className="mt-3 text-xs text-black/45">No generated soundtrack is authorized.</p>}
        <div className="mt-3 space-y-1 font-mono text-[8px]">
          {operations.map((operation) => <div key={operation.id} className="grid grid-cols-[1fr_auto_auto] gap-2 border-t border-black/10 py-1.5"><span className="truncate">{operation.type}</span><span>{operation.executionAuthority === "production_mandate" ? operation.estimatedCostUsd ? `$${operation.estimatedCostUsd}` : "paid" : "cost-free"}</span><b>{operation.state}</b></div>)}
        </div>
      </details>
      <p className="mt-3 rounded-lg bg-[#efffb6] p-2 text-[10px]"><b>Production approval only.</b> This authorizes the exact paid generation digests and cost ceiling. External publication remains separately gated.</p>
      {aggregate.state === "proposed" && onSeal ? <button type="button" disabled={busy} onClick={() => void onSeal(aggregate.id, aggregate.currentPlanDigest)} className="mt-3 rounded-full bg-[#11110f] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Seal exact revision</button> : null}
      {aggregate.state === "sealed" && onDecide ? <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => void onDecide(aggregate.id, aggregate.currentPlanDigest, "approved")} className="rounded-full bg-[#11110f] px-4 py-2 text-xs font-bold text-white disabled:opacity-50">Approve production · ${plan.maximumCostUsd}</button>
        <input value={feedback} onChange={(event) => setFeedback(event.target.value)} placeholder="Required rejection feedback" aria-label="Production rejection feedback" className="min-w-52 flex-1 rounded-full border border-black/15 px-3 py-2 text-xs" />
        <button type="button" disabled={busy || !feedback.trim()} onClick={() => void onDecide(aggregate.id, aggregate.currentPlanDigest, "rejected", feedback.trim())} className="rounded-full border border-red-400 px-4 py-2 text-xs font-bold text-red-700 disabled:opacity-40">Reject plan</button>
      </div> : null}
    </section>
  );
}
