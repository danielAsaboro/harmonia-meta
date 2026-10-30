import type { JobFull, Receipt } from "@/components/jobTypes";
import { SourceResolutionPanel } from "./SourceResolutionPanel";
import { outputLabel } from "./OutputIntentSelector";

function timestamp(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function planDate(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: timezone }).format(new Date(value));
}

function planDateTime(value: string, timezone: string) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: timezone, timeZoneName: "short",
  }).format(new Date(value));
}

function EditorialPlanSection({ job }: { job: JobFull }) {
  const plan = job.editorialPlan;
  if (!plan) return null;
  return (
    <section className="border border-black/15 bg-[#e8f1ff] p-5" data-canvas-artifact="editorial-plan:current">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#3157ff]">Temi editorial plan · v{plan.version}</p><h3 className="mt-1 font-serif text-xl">{plan.summary}</h3></div>
        <span className="rounded-full border border-black/15 px-2 py-1 font-mono text-[8px]">{plan.confidence} confidence</span>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-2 text-xs">
        <div><dt className="text-black/40">Planning horizon</dt><dd>{planDate(plan.horizonStartAt, plan.timezone)} – {planDate(plan.horizonEndAt, plan.timezone)}</dd></div>
        <div><dt className="text-black/40">Timezone</dt><dd>{plan.timezone}</dd></div>
        <div><dt className="text-black/40">Cadence</dt><dd>{plan.cadenceRationale}</dd></div>
        <div><dt className="text-black/40">Sequence</dt><dd>{plan.sequencingRationale}</dd></div>
      </dl>
      <ol className="mt-4 space-y-3">
        {plan.items.map((item) => {
          const state = job.editorialItemStates?.[item.id]?.status ?? item.productionStatus;
          const isSelected = item.id === job.selectedNextItemId && item.id === plan.selectedNextItemId;
          return <li key={item.id} className={`border-t pt-3 text-xs ${isSelected ? "border-[#3157ff]" : "border-black/10"}`} data-canvas-artifact={`editorial-item:${item.id}`}>
            <div className="flex items-start justify-between gap-2"><div><strong>{item.campaignTheme}</strong><span className="ml-2 text-black/45">{item.contentPillar}</span></div><span className="rounded-full bg-white px-2 py-1 text-xs">{state.replaceAll("_", " ")}</span></div>
            <p className="mt-2 text-black/65">{item.planningRationale}</p>
            {isSelected ? <p className="mt-1 font-medium text-[#3157ff]">Selected next: {item.selectionRationale}</p> : null}
            <p className="mt-1 text-[10px] text-black/50">Priority {item.priority} · Selection score {item.selectionScore} · {item.confidence} item confidence</p>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-black/60">
              <div><dt className="text-black/35">Posting window</dt><dd>{planDateTime(item.publicationWindowStartAt, plan.timezone)} – {planDateTime(item.publicationWindowEndAt, plan.timezone)}</dd></div>
              <div><dt className="text-black/35">Production deadline</dt><dd>{planDateTime(item.productionDeadlineAt, plan.timezone)}</dd></div>
              <div><dt className="text-black/35">Channel / format</dt><dd>{item.channel} · {item.format}</dd></div>
              <div><dt className="text-black/35">Dependencies</dt><dd>{item.dependencies.length ? item.dependencies.join(" · ") : "None"}</dd></div>
            </dl>
            {item.constraints.length ? <p className="mt-2 text-[10px]">Constraints: {item.constraints.join(" · ")}</p> : null}
            {item.requiredAssets.length ? <p className="mt-1 text-[10px]">Required assets: {item.requiredAssets.join(" · ")}</p> : null}
            <code className="mt-2 block text-[9px] text-black/40">Evidence: {item.evidenceRefs.join(" · ")}</code>
          </li>;
        })}
      </ol>
      {plan.assumptions.length ? <div className="mt-4 border-t border-black/10 pt-3"><p className="text-[9px] font-bold uppercase text-black/40">Assumptions</p><ul className="mt-1 text-[10px] text-black/60">{plan.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div> : null}
      {job.editorialPlanEvidenceLineage?.length ? <code className="mt-3 block text-[9px] text-black/40">Plan provenance: {job.editorialPlanEvidenceLineage.join(" · ")}</code> : null}
      {job.editorialPlanningSnapshot ? <details className="mt-3 border-t border-black/10 pt-3 text-[10px] text-black/55">
        <summary className="cursor-pointer font-bold uppercase">Planning snapshot · {plan.planningSnapshotId}</summary>
        <p className="mt-2">Captured {planDateTime(job.editorialPlanningSnapshot.asOf, job.editorialPlanningSnapshot.timezone)} · {job.editorialPlanningSnapshot.existingCommitments.length} commitments · {job.editorialPlanningSnapshot.calendarProjection.length} calendar projections</p>
        <code className="mt-1 block text-[9px]">Snapshot provenance: {job.editorialPlanningSnapshot.provenanceIds.join(" · ")}</code>
      </details> : null}
    </section>
  );
}

export function SourcesWorkspace({ job }: { job: JobFull; receipts: Receipt[] }) {
  const normalizedSegments = (job.normalizedSources ?? []).flatMap((source) => source.segments.map((segment) => ({ source, segment })));
  return (
    <div className="grid gap-5 xl:grid-cols-[1.35fr_1fr]">
      <section className="border border-black/15 bg-[#fffdf7] p-5"><div className="mb-4 flex items-end justify-between"><div><p className="text-xs font-black uppercase tracking-[0.12em] text-[#3157ff]">Ground truth</p><h3 className="font-serif text-2xl">Normalized sources</h3></div><span className="text-xs text-black/45">{normalizedSegments.length} segments</span></div><ol className="max-h-[56vh] space-y-3 overflow-y-auto pr-2">{normalizedSegments.map(({ source, segment }) => <li key={`${source.sourceId}:${segment.id}`} data-canvas-artifact={`source:${source.sourceId}:${segment.id}`} className="border-t border-black/10 pt-3"><span className="text-xs font-bold text-[#b64225]">{source.title} · {segment.locator.kind.replaceAll("_", " ")}</span><p className="mt-1 text-sm leading-6 text-black/70">{segment.text}</p><details className="mt-2"><summary className="cursor-pointer text-xs font-bold text-black/45">Source location</summary><code className="mt-1 block text-[10px] text-black/45">{JSON.stringify(segment.locator)}</code></details></li>)}</ol>{!normalizedSegments.length ? <p className="py-8 text-sm text-black/40">Sources are being collected and extracted. Failures pause for operator resolution.</p> : null}</section>
      <div className="space-y-5">
        {job.stage === "awaiting_source_resolution" ? <SourceResolutionPanel jobId={job.id} sources={job.sourceRecords ?? []} /> : null}
        {job.campaignOutputPlan ? <section className="border border-black/15 bg-[#e8f1ff] p-5"><p className="text-xs font-black uppercase tracking-[0.12em] text-[#3157ff]">Campaign output plan</p><h3 className="font-serif text-xl">{job.campaignOutputPlan.outputs.length} grounded output{job.campaignOutputPlan.outputs.length === 1 ? "" : "s"}</h3><div className="mt-3 flex flex-wrap gap-2">{job.campaignOutputPlan.outputs.map((output) => <span key={output.id} className="rounded-full border border-black/15 bg-white px-2 py-1 text-xs">{outputLabel(output.outputType)} · {output.approvalClass === "effect" ? "approval before action" : "strategy approval"}</span>)}</div><details className="mt-3"><summary className="cursor-pointer text-xs font-bold text-black/50">Plan provenance</summary><code className="mt-1 block break-all text-[10px] text-black/45">{job.campaignOutputPlan.digest}</code></details>{job.campaignOutputPlan.desiredOutputs.some((item) => !job.campaignOutputPlan!.outputs.some((output) => output.outputType === item)) ? <p className="mt-2 text-xs text-amber-700">Some requested outputs are ineligible for the available evidence or outside the allowed set.</p> : null}</section> : null}
        {job.contentStrategy ? <section className="border border-black/15 bg-[#f0edff] p-5" data-canvas-artifact="strategy:current"><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#5165ff]">Ryan strategy · v{job.contentStrategy.version}</p><h3 className="mt-1 font-serif text-xl">{job.contentStrategy.thesis}</h3></div><span className="rounded-full border border-black/15 px-2 py-1 font-mono text-[8px]">{job.strategyApprovalState ?? "pending"}</span></div><p className="mt-3 text-xs leading-5 text-black/60">{job.contentStrategy.differentiatedNarrative}</p><dl className="mt-4 grid grid-cols-3 gap-2 text-xs"><div><dt className="text-black/40">Horizon</dt><dd>{job.contentStrategy.horizonWeeks} weeks</dd></div><div><dt className="text-black/40">Confidence</dt><dd>{job.contentStrategy.confidence}</dd></div><div><dt className="text-black/40">Briefs</dt><dd>{job.contentStrategy.briefs.length}</dd></div></dl><div className="mt-4 flex flex-wrap gap-1">{job.contentStrategy.pillars.map((pillar) => <span key={pillar.name} className="rounded-full bg-white px-2 py-1 text-[9px]">{pillar.name}</span>)}</div><details className="mt-4"><summary className="cursor-pointer text-[10px] font-bold uppercase">Briefs and provenance</summary><ol className="mt-2 space-y-2">{job.contentStrategy.briefs.map((brief) => <li key={brief.id} className="border-t border-black/10 pt-2 text-xs"><b>{brief.title}</b><p className="mt-1 text-black/55">{brief.keyMessage}</p><code className="mt-1 block text-[9px] text-black/40">{brief.evidenceRefs.join(" · ")}</code></li>)}</ol>{job.contentStrategy.assumptions.length ? <ul className="mt-3 text-[10px] text-black/50">{job.contentStrategy.assumptions.map((item) => <li key={item.text}>Assumption ({item.confidence}): {item.text}</li>)}</ul> : null}</details></section> : null}
        <EditorialPlanSection job={job} />
        {job.sourceAnalysis ? <section className="border border-black/15 bg-[#d9ff43]/30 p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-[9px] font-black uppercase tracking-[0.18em] text-[#3157ff]">Nimi source analysis</p><h3 className="font-serif text-xl">{job.sourceAnalysis.summary}</h3></div><span className="font-mono text-[9px]">{job.sourceAnalysis.confidence}</span></div><code className="mt-2 block break-all text-[8px] text-black/45">Source {job.sourceAnalysis.sourceDigest}<br />Analysis {job.analysisDigest}</code>{job.sourceAnalysis.assumptions.map((assumption) => <p key={assumption} className="mt-2 text-[10px] text-black/55">Assumption: {assumption}</p>)}{job.analysisResearchRequest ? <div className="mt-3 border border-black/15 bg-white/60 p-3"><p className="text-[9px] font-black uppercase tracking-[0.16em]">Web research</p><p className="mt-1 text-xs">{job.analysisResearchRequest.question}</p>{(job.analysisSearchEvidence ?? []).map((source) => <p key={source.evidenceId} className="mt-2 text-[10px]"><span className="font-mono">{source.evidenceId}</span><br /><a className="underline" href={source.url} rel="noreferrer" target="_blank">{source.title}</a> — {source.supportedText}</p>)}</div> : null}<div className="mt-3 space-y-3">{job.sourceAnalysis.moments.map((moment) => <article key={moment.id} className="border-t border-black/15 pt-3"><div className="flex justify-between gap-3"><strong className="text-sm">{moment.title}</strong><span className="shrink-0 font-mono text-[10px]">{timestamp(moment.startSec)}–{timestamp(moment.endSec)} · {moment.confidence}</span></div><p className="mt-1 text-xs leading-5 text-black/60">{moment.hook}</p><blockquote className="mt-1 text-[10px] italic">“{moment.quote}”</blockquote><code className="mt-1 block text-[9px] text-black/45">Segments: {moment.sourceSegmentRefs.join(" · ")}{moment.visualEvidenceIds.length ? ` · Frames: ${moment.visualEvidenceIds.join(" · ")}` : ""}</code>{moment.cropSuitability ? <span className="mt-2 inline-block bg-white/70 px-2 py-1 text-[9px] font-bold uppercase">crop {moment.cropSuitability}</span> : null}</article>)}</div></section> : null}
        {job.sourceAnalysis ? <section className="border border-black/15 bg-[#fffdf7] p-5"><h3 className="font-serif text-xl">Grounded angles</h3><div className="mt-3 space-y-3">{job.sourceAnalysis.angles.map((angle) => <article key={angle.id}><span className="text-[9px] font-black uppercase tracking-wider text-[#8d5cff]">{angle.angleType} · {angle.evidenceKind} · {angle.confidence}</span><strong className="block text-sm">{angle.title}</strong><p className="mt-1 text-xs leading-5 text-black/55">{angle.rationale}</p><code className="mt-1 block text-[9px] text-black/40">Evidence: {angle.evidenceRefs.join(" · ")}</code>{angle.assumptions.map((assumption) => <p key={assumption} className="text-[9px] text-black/45">Assumption: {assumption}</p>)}</article>)}</div></section> : null}
      </div>
    </div>
  );
}
