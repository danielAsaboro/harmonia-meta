import type { JobFull } from "@/components/jobTypes";
import { outputLabel } from "./OutputIntentSelector";

function destinationLabel(value: string): string {
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  if (value.toLowerCase() === "instagram") return "Instagram";
  if (value.toLowerCase() === "youtube") return "YouTube";
  if (value.toLowerCase() === "tiktok") return "TikTok";
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function JobBriefCard({ job }: { job: JobFull }) {
  const outputs = job.config.desiredOutputs.map(outputLabel);
  const destinations = job.config.platforms.map(destinationLabel);
  const sourceCount = job.sourceRecords?.length ?? job.normalizedSources?.length ?? 0;
  return <details className="mb-4 rounded-[16px] border border-black/10 bg-[#e9e5dc]/70">
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3157ff]">
      <span>Saved job brief</span>
      <span className="ml-auto text-xs font-normal text-black/45">{outputs.length} output{outputs.length === 1 ? "" : "s"} · {sourceCount} source{sourceCount === 1 ? "" : "s"}</span>
    </summary>
    <div className="grid gap-4 border-t border-black/10 bg-white/55 p-4 lg:grid-cols-[1.5fr_1fr]">
      <div><p className="text-xs font-bold uppercase tracking-[0.1em] text-black/40">Outcome</p><p className="mt-1 text-sm leading-6">{job.config.operatorBrief?.trim() || "Create grounded content from the selected source material."}</p></div>
      <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-1">
        <div><dt className="text-xs font-bold uppercase tracking-[0.1em] text-black/40">Outputs</dt><dd className="mt-1">{outputs.join(" · ") || "Not selected"}</dd></div>
        <div><dt className="text-xs font-bold uppercase tracking-[0.1em] text-black/40">Destinations</dt><dd className="mt-1">{destinations.join(" · ") || "Export only"}</dd></div>
      </dl>
    </div>
  </details>;
}
