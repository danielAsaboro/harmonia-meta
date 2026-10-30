/* eslint-disable @next/next/no-img-element */
import type { JobFull } from "@/components/jobTypes";
import type { StudioWorkspaceModel } from "@/lib/studio/workspaceModel";
import { contentArtifactPreview } from "@/lib/contentArtifacts/presentation";

function directionFor(job: JobFull): string {
  const artifact = job.contentArtifacts?.[0];
  return job.sourceAnalysis?.angles[0]?.title || job.sourceAnalysis?.moments[0]?.hook || (artifact ? contentArtifactPreview(artifact).split(/[.!?]/)[0] : "") || job.sourceAnalysis?.summary || "Content direction in progress";
}

export function ArtifactBoard({ job, model, onSelect }: { job: JobFull; model: StudioWorkspaceModel; onSelect: (artifactId: string, view?: string) => void }) {
  const invalidTraces = model.traceLinks.filter((trace) => !trace.valid);
  const artifact = model.written[0];
  const visual = model.visual[0];
  const audio = model.audio[0];
  const sourceCount = model.sources.normalizedSources.length;
  const mediaCount = model.visual.length + model.motion.length + model.audio.length;
  const stages = [
    { label: "Source", color: "#d8ff3e", detail: sourceCount ? `${sourceCount} source${sourceCount === 1 ? "" : "s"}` : "Awaiting source" },
    { label: "Draft", color: "#ff927f", detail: model.written.length ? `${model.written.length} draft${model.written.length === 1 ? "" : "s"}` : "No drafts yet" },
    { label: "Media", color: "#bc96ff", detail: mediaCount ? `${mediaCount} asset${mediaCount === 1 ? "" : "s"}` : "No media yet" },
  ];
  const decisions = [
    ...(job.sourceAnalysis?.angles ?? []).slice(0, 2).map((angle) => ({ label: angle.title, source: `${angle.angleType} · ${angle.evidenceKind}` })),
    ...(job.sourceAnalysis?.moments ?? []).slice(0, 3).map((moment) => ({ label: moment.hook || moment.title, source: `${moment.startSec}s` })),
  ].slice(0, 3);

  if (invalidTraces.length) return <section role="alert" className="rounded-[18px] border-2 border-red-600 bg-red-50 p-4"><strong className="text-sm text-red-800">Source trace protocol error</strong><ul className="mt-2 list-disc pl-5 text-xs text-red-700">{invalidTraces.map((trace, index) => <li key={`${trace.artifactId ?? trace.actionId}-${index}`}>{trace.error}</li>)}</ul></section>;

  return (
    <div className="grid gap-3 xl:grid-cols-[1.08fr_.92fr] xl:grid-rows-[minmax(230px,auto)_minmax(190px,auto)]">
      <article className="relative flex min-w-0 flex-col rounded-[18px] bg-[#11110f] p-5 text-white sm:p-6 xl:row-span-2">
        <div className="flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-[0.1em] text-[#b7b7ac]">Campaign direction <span className="ml-auto rounded-full border border-[#d8ff3e]/20 bg-[#d8ff3e]/5 px-2.5 py-1 text-[11px] tracking-normal text-[#d8ff3e]">From conversation</span></div>
        <h2 className="mt-5 max-w-lg text-balance break-words text-[26px] font-semibold leading-[1.15] tracking-[-0.035em]">{directionFor(job)}</h2>
        <p className="mt-3 max-w-md text-xs leading-relaxed text-[#aaa99e]">The working direction, grounded in this job’s saved source analysis and content.</p>
        <div className="my-5">
          {decisions.length ? decisions.map((decision, index) => <div key={`${decision.source}-${index}`} className="flex items-start gap-3 border-t border-white/10 py-3"><span className="pt-0.5 font-mono text-[10px] tabular-nums text-[#a2aa7f]">{String(index + 1).padStart(2, "0")}</span><div className="min-w-0"><p className="break-words text-xs font-medium leading-relaxed text-[#e5e5de]">{decision.label}</p><p className="mt-1 font-mono text-[10px] text-[#9b9b8f]">{decision.source.replaceAll("_", " ")}</p></div></div>) : <div className="border-t border-white/10 py-3 text-xs leading-relaxed text-[#aaa99e]">Direction will sharpen as evidence and angles are saved.</div>}
        </div>
        <ol aria-label="Content workflow" className="mt-auto grid grid-cols-3 gap-2 border-t border-white/10 pt-5">
          {stages.map((stage, index) => <li key={stage.label} className="relative min-w-0 rounded-xl border border-white/10 bg-white/[0.035] px-2.5 py-3 sm:px-3">
            {index < stages.length - 1 && <span aria-hidden="true" className="absolute -right-[9px] top-[22px] z-10 grid h-4 w-4 place-items-center bg-[#11110f] text-xs text-[#8a8a7a]">→</span>}
            <div className="flex items-center gap-2"><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: stage.color }} /><span className="text-xs font-semibold" style={{ color: stage.color }}>{stage.label}</span></div>
            <p className="mt-2 text-[11px] leading-snug text-[#b9b9ac]">{stage.detail}</p>
          </li>)}
        </ol>
      </article>

      <button type="button" onClick={() => artifact && onSelect(`artifact:${artifact.id}`, "written")} className="overflow-hidden rounded-[18px] border border-black/10 bg-white p-[14px] text-left transition hover:-translate-y-0.5 hover:border-[#5165ff] disabled:cursor-default" disabled={!artifact}>
        <div className="flex items-center text-xs font-bold uppercase tracking-[0.08em]">Content artifact <span className="ml-auto rounded-full bg-[#efffb6] px-2 py-1 text-black">{artifact ? `revision ${artifact.revision}` : "not created"}</span></div>
        {artifact ? <><blockquote className="my-5 line-clamp-4 whitespace-pre-wrap text-[17px] font-bold leading-[1.25] tracking-[-0.03em]">{contentArtifactPreview(artifact)}</blockquote><div className="flex gap-2 text-xs"><span className="flex-1 rounded-lg border border-black/10 p-2 text-[#777]">{artifact.outputType.replaceAll("_", " ")}</span><span className="flex-1 rounded-lg border border-[#758636] bg-[#f2ffc0] p-2 text-[#414822]">Source-linked · {artifact.sourceSegmentRefs.length} reference{artifact.sourceSegmentRefs.length === 1 ? "" : "s"}</span></div></> : <p className="mt-8 text-sm text-black/45">No persisted content artifact exists yet.</p>}
      </button>

      <article className="grid min-h-[190px] grid-cols-2 gap-2 rounded-[18px] border border-black/10 bg-white p-[14px]">
        <button type="button" onClick={() => visual && onSelect(`visual:${visual.actionId}`, "visual")} className="relative overflow-hidden rounded-xl bg-[#222] text-left" disabled={!visual}>
          {visual ? <img src={`/api/jobs/${job.id}/assets/${visual.actionId}`} alt={visual.title} className="h-full w-full object-cover opacity-90" /> : <div className="grid h-full min-h-32 place-items-center bg-[#ded9ce] p-3 text-center text-xs text-black/45">No persisted image</div>}
          <span className="absolute left-2 top-2 rounded-full bg-white/85 px-2 py-1 text-[11px] text-black">{visual ? "Image · open asset" : "Visual · unresolved"}</span>
        </button>
        <button type="button" onClick={() => audio && onSelect(`audio:${audio.actionId}`, "audio")} className="rounded-xl bg-[#5165ff] p-3 text-left text-white" disabled={!audio}>
          <div className="flex h-[55px] items-center gap-0.5" aria-hidden>{Array.from({ length: 14 }, (_, index) => <i key={index} className="w-[3px] rounded bg-[#d8ff3e]" style={{ height: `${20 + ((index * 17) % 38)}px` }} />)}</div>
          <b className="block text-xs">{audio?.title ?? "Audio not created"}</b>
          <p className="mt-1 text-[11px] text-[#c8cdff]">{audio ? `${audio.mime} · persisted` : "unresolved · no simulated asset"}</p>
        </button>
      </article>
    </div>
  );
}
