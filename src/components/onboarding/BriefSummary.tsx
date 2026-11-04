export interface BriefEvidence { id: string; kind: string; text: string; url: string; title: string; check?: "quote" | "source" }
export interface BriefAudience { id: string; name: string; pains: string[]; jobsToBeDone: string[]; objections: string[]; evidenceIds: string[] }
export interface StoredBrief {
  website: string; digest: string; createdAt: string; editedAt?: string;
  pages: Array<{ pageId: string; role: string; url: string; title: string }>;
  evidence: BriefEvidence[]; unverifiedResearchDropped: number;
  modelCalls: Array<{ step: string; model: string; searchCalls: number; inputTokens: number; outputTokens: number; costUsd: string }>;
  cost: { totalUsd: string; pricingVersion: string; durationMs: number };
  brief: {
    company: string; category: string; positioning: string; audiences: BriefAudience[];
    competitors: Array<{ name: string; howWeDiffer: string; evidenceIds: string[] }>;
    pillars: Array<{ name: string; purpose: string; evidenceIds: string[] }>;
    voiceRules: string[]; exclusions: string[];
  };
}

const STEP_NAMES: Record<string, string> = {
  read_site: "Read the site", research_competitors: "Competitor search", research_customer_pain: "Customer pain search", synthesize_brief: "Write the brief",
};

const usd = (value: string | number) => "$" + Number(value).toFixed(Number(value) < 0.01 ? 4 : 2);

/** What building the brief cost at Meta list price, call by call. */
function CostReceipt({ brief }: { brief: StoredBrief }) {
  const searches = brief.modelCalls.reduce((sum, call) => sum + call.searchCalls, 0);
  return (
    <details className="mt-1 text-[11px] text-zinc-500" data-cost-receipt>
      <summary className="cursor-pointer list-none">
        Built in {Math.round(brief.cost.durationMs / 1000)}s · {brief.modelCalls.length} model calls · {searches} web searches · <b className="font-medium text-zinc-700 dark:text-zinc-300">{usd(brief.cost.totalUsd)}</b> at Meta list price
      </summary>
      <table className="mt-2 w-full font-mono text-[10px]">
        <tbody>{brief.modelCalls.map((call) => (
          <tr key={call.step} className="border-t border-zinc-200 dark:border-zinc-800">
            <td className="py-1 pr-2">{STEP_NAMES[call.step] ?? call.step}</td>
            <td className="pr-2">{call.model}</td>
            <td className="pr-2 text-right">{call.inputTokens.toLocaleString()} in / {call.outputTokens.toLocaleString()} out</td>
            <td className="pr-2 text-right">{call.searchCalls ? `${call.searchCalls} search` : ""}</td>
            <td className="text-right">{usd(call.costUsd)}</td>
          </tr>
        ))}</tbody>
      </table>
      <p className="mt-1">Pricing {brief.cost.pricingVersion}. A list-price reconstruction, not an invoice.</p>
    </details>
  );
}

function Sources({ ids, evidence }: { ids: string[]; evidence: BriefEvidence[] }) {
  const items = ids.map((id) => evidence.find((item) => item.id === id)).filter((item): item is BriefEvidence => Boolean(item));
  if (!items.length) return null;
  return <span className="ml-1 inline-flex flex-wrap gap-1">{items.map((item) => (
    <a key={item.id} href={item.url} target="_blank" rel="noreferrer" title={`${item.title || item.url}\n“${item.text}”${item.check === "source" ? "\n(source confirmed by Meta search; text not returned)" : ""}`}
      className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 underline-offset-2 hover:underline dark:bg-zinc-900 dark:text-zinc-300">
      {item.kind === "site" ? "site" : new URL(item.url).hostname.replace(/^www\./, "")}
    </a>
  ))}</span>;
}

/** The cited brand brief: who it is for, what hurts, who else sells it, and how to sound. */
export function BriefSummary({ brief }: { brief: StoredBrief }) {
  const b = brief.brief;
  const outside = brief.evidence.filter((item) => item.kind !== "site").length;
  return (
    <div className="space-y-4 text-xs leading-5">
      <div>
        <p className="text-sm font-medium">{b.company} <span className="font-normal text-zinc-500">· {b.category}</span></p>
        <p className="mt-1 text-zinc-700 dark:text-zinc-300">{b.positioning}</p>
        <p className="mt-1 text-[11px] text-zinc-500">From {brief.pages.length} pages of {brief.website} and {outside} outside sources · {brief.unverifiedResearchDropped} unconfirmed research items dropped</p>
        <CostReceipt brief={brief} />
      </div>
      <div>
        <h4 className="font-medium">Target customers</h4>
        <ul className="mt-1 space-y-2">{b.audiences.map((audience) => (
          <li key={audience.id}><b>{audience.name}</b><Sources ids={audience.evidenceIds} evidence={brief.evidence} />
            <ul className="ml-4 list-disc text-zinc-600 dark:text-zinc-400">{audience.pains.map((pain) => <li key={pain}>{pain}</li>)}</ul></li>
        ))}</ul>
      </div>
      {b.competitors.length ? <div>
        <h4 className="font-medium">Competitors</h4>
        <ul className="mt-1 space-y-1">{b.competitors.map((competitor) => <li key={competitor.name}><b>{competitor.name}</b>: {competitor.howWeDiffer}<Sources ids={competitor.evidenceIds} evidence={brief.evidence} /></li>)}</ul>
      </div> : null}
      <div>
        <h4 className="font-medium">Messaging pillars</h4>
        <ul className="mt-1 space-y-1">{b.pillars.map((pillar) => <li key={pillar.name}><b>{pillar.name}</b>: {pillar.purpose}<Sources ids={pillar.evidenceIds} evidence={brief.evidence} /></li>)}</ul>
      </div>
      <div>
        <h4 className="font-medium">Voice</h4>
        <ul className="mt-1 ml-4 list-disc">{b.voiceRules.map((rule) => <li key={rule}>{rule}</li>)}</ul>
      </div>
    </div>
  );
}
