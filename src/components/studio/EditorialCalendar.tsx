import type { JobFull } from "@/components/jobTypes";
import { StudioEmpty } from "./StudioStates";

function channelLabel(value: string): string {
  if (value.toLowerCase() === "x") return "X";
  if (value.toLowerCase() === "linkedin") return "LinkedIn";
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function EditorialCalendar({ job }: { job: JobFull }) {
  const plan = job.editorialPlan;
  if (!plan) return <StudioEmpty title="No editorial calendar yet">The saved schedule will appear here after strategy approval and editorial planning.</StudioEmpty>;
  const groups = new Map<string, typeof plan.items>();
  for (const item of plan.items) {
    const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: plan.timezone }).format(new Date(item.publicationWindowStartAt));
    groups.set(day, [...(groups.get(day) ?? []), item]);
  }
  return <section aria-labelledby="editorial-calendar-heading" className="rounded-[18px] border border-black/10 bg-white/70 p-4 sm:p-5">
    <div className="flex flex-wrap items-end gap-3"><div><p className="text-xs font-black uppercase tracking-[0.12em] text-[#3157ff]">Editorial calendar</p><h2 id="editorial-calendar-heading" className="mt-1 font-serif text-2xl">{plan.summary}</h2></div><span className="ml-auto rounded-full bg-[#e8edff] px-3 py-1 text-xs font-bold text-[#3157ff]">{plan.timezone}</span></div>
    <div className="mt-5 space-y-5">{[...groups.entries()].map(([day, items]) => <section key={day} className="grid gap-3 border-t border-black/10 pt-4 sm:grid-cols-[7rem_1fr]"><h3 className="text-sm font-black">{day}</h3><ol className="space-y-2">{items.map((item) => {
      const selected = item.id === job.selectedNextItemId || item.id === plan.selectedNextItemId;
      const state = job.editorialItemStates?.[item.id]?.status ?? item.productionStatus;
      return <li key={item.id} className={`rounded-xl border p-3 ${selected ? "border-[#3157ff] bg-[#eef2ff]" : "border-black/10 bg-[#f7f4ed]"}`}><div className="flex flex-wrap items-center gap-2"><b className="text-sm">{item.campaignTheme}</b>{selected ? <span className="rounded-full bg-[#3157ff] px-2 py-0.5 text-[10px] font-bold text-white">Up next</span> : null}<span className="ml-auto text-xs text-black/45">{channelLabel(item.channel)} · {item.format.replaceAll("_", " ")}</span></div><p className="mt-1 text-sm text-black/60">{item.planningRationale}</p><div className="mt-2 flex gap-3 text-xs text-black/45"><time>{new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: plan.timezone }).format(new Date(item.publicationWindowStartAt))}</time><span>{state.replaceAll("_", " ")}</span></div></li>;
    })}</ol></section>)}</div>
  </section>;
}
