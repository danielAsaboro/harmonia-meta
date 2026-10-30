import type { JobFull, Receipt } from "@/components/jobTypes";
import type { TimelineEvent } from "@/components/Timeline";

function secondsBetween(from?: string | null, to?: string | null): number | null {
  if (!from || !to) return null;
  const difference = Date.parse(to) - Date.parse(from);
  return Number.isFinite(difference) ? Math.max(0, Math.round(difference / 1000)) : null;
}

function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return "pending";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function short(value?: string): string {
  return value ? `${value.slice(0, 10)}…` : "pending";
}

export function JobExecutionProof({ job, events, receipts, initiallyOpen = false }: { job: JobFull; events: TimelineEvent[]; receipts: Receipt[]; initiallyOpen?: boolean }) {
  const decisions = job.decisions ?? [];
  const approved = decisions.filter((decision) => decision.decision === "approved");
  const claims = job.claims ?? [];
  const appliedClaim = [...claims].reverse().find((claim) => claim.state === "applied");
  const receipt = appliedClaim
    ? receipts.find((candidate) => candidate.id === appliedClaim.receiptId)
    : [...receipts].reverse().find((candidate) => candidate.outcome === "applied");
  const verification = receipt
    ? (job.verifications ?? []).find((candidate) => candidate.receiptId === receipt.id)
    : undefined;
  const waitingEvent = events.find((event) => event.stage === "awaiting_approval");
  const firstDecision = [...decisions].sort((a, b) => a.decidedAt.localeCompare(b.decidedAt))[0];
  const elapsed = secondsBetween(job.createdAt, job.updatedAt);
  const approvalWait = secondsBetween(waitingEvent?.at, firstDecision?.decidedAt);
  const handsOff = elapsed === null ? null : Math.max(0, elapsed - (approvalWait ?? 0));
  const specialistStages = [...new Set(events.filter((event) => event.actor === "agent").map((event) => event.stage))];
  const approvedCount = new Set(approved.map((decision) => decision.actionId)).size;
  const verifiedCount = new Set((job.verifications ?? []).filter((item) => item.verified).map((item) => item.actionId)).size;
  const yieldText = job.actions.length ? `${approvedCount}/${job.actions.length}` : "0/0";

  const lineage = [
    ["Persisted stage", job.stage],
    ["Specialist handoffs", specialistStages.length ? `${specialistStages.length} · ${specialistStages.join(" → ")}` : "pending"],
    ["Approval decision", firstDecision ? `${firstDecision.decision} · ${firstDecision.channel} · ${short(firstDecision.operationId)}` : "pending"],
    ["Effect claim", appliedClaim ? `${appliedClaim.state} · attempt ${appliedClaim.attempt} · ${short(appliedClaim.operationId)}` : "pending"],
    ["Receipt", receipt ? `${receipt.outcome} · ${short(receipt.id)}` : "pending"],
    ["Independent verification", verification ? `${verification.verified ? "verified" : "failed"} · ${verification.method}` : "pending"],
  ];
  const metrics = [
    ["Normalized sources", String(job.normalizedSources?.length ?? 0)],
    ["Hands-off time", duration(handsOff)],
    ["Operator actions", String(decisions.length)],
    ["Outputs", String(job.actions.length)],
    ["Approved-output yield", yieldText],
    ["Verified outputs", String(verifiedCount)],
  ];

  return <details className="border border-black/15 bg-white/55" open={initiallyOpen}>
    <summary className="cursor-pointer px-4 py-3 text-xs font-black uppercase tracking-[0.12em]">Execution proof · audit trail</summary>
    <div className="grid border-t border-black/10 lg:grid-cols-[1.35fr_1fr]">
      <dl className="grid gap-px bg-black/10 sm:grid-cols-2">{lineage.map(([label, value]) => <div key={label} className="bg-[#f4f0e8] p-3"><dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-black/45">{label}</dt><dd className="mt-1 break-words text-xs font-bold">{value}</dd></div>)}</dl>
      <dl className="grid grid-cols-2 gap-px border-t border-black/10 bg-black/10 lg:border-l lg:border-t-0">{metrics.map(([label, value]) => <div key={label} className="bg-white p-3"><dt className="text-[11px] font-bold uppercase tracking-[0.08em] text-black/45">{label}</dt><dd className="mt-1 text-sm font-black">{value}</dd></div>)}</dl>
    </div>
    <p className="border-t border-black/10 px-4 py-2 text-[11px] text-black/45">Elapsed {duration(elapsed)} · approval wait {duration(approvalWait)} · identifiers truncated for display</p>
  </details>;
}
