"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/clientApi";
import { Button } from "@/components/dashboard/Button";
import { Textarea, TextInput } from "@/components/dashboard/Controls";
import { SectionHeader } from "@/components/dashboard/DashboardPage";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Surface } from "@/components/dashboard/Surface";

interface Evidence { id: string; kind: string; text: string; url: string; title: string; check?: "quote" | "source" }
interface Audience { id: string; name: string; pains: string[]; jobsToBeDone: string[]; objections: string[]; evidenceIds: string[] }
interface Brief {
  website: string; digest: string; createdAt: string; editedAt?: string;
  pages: Array<{ pageId: string; role: string; url: string; title: string }>;
  evidence: Evidence[]; unverifiedResearchDropped: number;
  modelCalls: Array<{ step: string; model: string; searchCalls: number }>;
  brief: {
    company: string; category: string; positioning: string; audiences: Audience[];
    competitors: Array<{ name: string; howWeDiffer: string; evidenceIds: string[] }>;
    pillars: Array<{ name: string; purpose: string; evidenceIds: string[] }>;
    voiceRules: string[]; exclusions: string[];
  };
}

const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

function Sources({ ids, evidence }: { ids: string[]; evidence: Evidence[] }) {
  const items = ids.map((id) => evidence.find((item) => item.id === id)).filter((item): item is Evidence => Boolean(item));
  if (!items.length) return null;
  return <span className="ml-1 inline-flex flex-wrap gap-1">{items.map((item) => (
    <a key={item.id} href={item.url} target="_blank" rel="noreferrer" title={`${item.title || item.url}\n“${item.text}”${item.check === "source" ? "\n(source confirmed by Meta search; text not returned)" : ""}`}
      className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 underline-offset-2 hover:underline dark:bg-zinc-900 dark:text-zinc-300">
      {item.kind === "site" ? "site" : new URL(item.url).hostname.replace(/^www\./, "")}
    </a>
  ))}</span>;
}

export function BrandBriefSettings() {
  const [brief, setBrief] = useState<Brief | null>(null);
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "building" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ positioning: "", voice: "", exclusions: "", audiences: [] as Array<{ id: string; name: string; pains: string }> });

  useEffect(() => {
    apiFetch("/api/onboarding/website").then((r) => (r.ok ? r.json() : null)).then((d) => d?.brandBrief && setBrief(d.brandBrief)).catch(() => undefined);
  }, []);

  async function build() {
    setState("building"); setMessage("Reading the site and researching competitors and customers with Meta web search… about a minute.");
    const response = await apiFetch("/api/onboarding/website", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url }) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setState("error"); setMessage(body.error ?? "Could not build the brief."); return; }
    setBrief(body.brandBrief); setState("idle"); setMessage("Brief saved. Every new job now starts from it.");
  }

  function startEdit() {
    if (!brief) return;
    setDraft({
      positioning: brief.brief.positioning, voice: brief.brief.voiceRules.join("\n"), exclusions: brief.brief.exclusions.join("\n"),
      audiences: brief.brief.audiences.map((audience) => ({ id: audience.id, name: audience.name, pains: audience.pains.join("\n") })),
    });
    setEditing(true);
  }

  async function saveEdit() {
    setState("saving");
    const response = await apiFetch("/api/onboarding/website", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        positioning: draft.positioning.trim(), voiceRules: lines(draft.voice), exclusions: lines(draft.exclusions),
        audiences: draft.audiences.map((audience) => ({ id: audience.id, name: audience.name.trim(), pains: lines(audience.pains) })),
      }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) { setState("error"); setMessage(body.error ?? "Could not save the edit."); return; }
    setBrief(body.brandBrief); setEditing(false); setState("idle"); setMessage("Edit saved. New jobs use your version.");
  }

  const b = brief?.brief;
  const outside = brief?.evidence.filter((item) => item.kind !== "site").length ?? 0;
  return (
    <Surface as="section" className="settings-section settings-section--strategy">
      <SectionHeader title="Brand brief" description="Give Harmonia your website once. It reads the site, researches competitors and customer pain with Meta web search, and every job starts from this brief."
        metadata={<StatusBadge tone={state === "error" ? "danger" : brief ? "success" : state === "building" ? "info" : "neutral"}>{state === "building" ? "Building" : brief ? (brief.editedAt ? "Edited" : "Active") : "Not set"}</StatusBadge>} />
      <div className="mt-3 flex gap-2">
        <TextInput aria-label="Company website" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && void build()} placeholder={brief ? `Rebuild from a site (current: ${brief.website})` : "yourcompany.com"} />
        <Button variant="primary" disabled={!url.trim() || state === "building"} onClick={() => void build()}>{state === "building" ? "Building…" : brief ? "Rebuild" : "Build brief"}</Button>
      </div>
      {message ? <p className="mt-2 text-xs" role={state === "error" ? "alert" : "status"}>{message}</p> : null}

      {brief && b && !editing ? (
        <div className="mt-4 space-y-4 text-xs leading-5">
          <div>
            <p className="text-sm font-medium">{b.company} <span className="font-normal text-zinc-500">· {b.category}</span></p>
            <p className="mt-1 text-zinc-700 dark:text-zinc-300">{b.positioning}</p>
            <p className="mt-1 text-[11px] text-zinc-500">From {brief.pages.length} pages of {brief.website} and {outside} outside sources · {brief.modelCalls.map((call) => call.model).filter((m, i, all) => all.indexOf(m) === i).join(" + ")} · {brief.unverifiedResearchDropped} unconfirmed research items dropped</p>
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
          <Button onClick={startEdit}>Edit brief</Button>
        </div>
      ) : null}

      {editing ? (
        <div className="mt-4 space-y-3 text-xs">
          <label className="block">Positioning<Textarea aria-label="Positioning" value={draft.positioning} onChange={(e) => setDraft({ ...draft, positioning: e.target.value })} /></label>
          {draft.audiences.map((audience, index) => (
            <div key={audience.id} className="rounded border p-2">
              <TextInput aria-label={`Customer ${index + 1} name`} value={audience.name} onChange={(e) => setDraft({ ...draft, audiences: draft.audiences.map((item, i) => i === index ? { ...item, name: e.target.value } : item) })} />
              <label className="mt-1 block">Pains, one per line<Textarea aria-label={`Customer ${index + 1} pains`} value={audience.pains} onChange={(e) => setDraft({ ...draft, audiences: draft.audiences.map((item, i) => i === index ? { ...item, pains: e.target.value } : item) })} /></label>
            </div>
          ))}
          <label className="block">Voice rules, one per line<Textarea aria-label="Voice rules" value={draft.voice} onChange={(e) => setDraft({ ...draft, voice: e.target.value })} /></label>
          <label className="block">Avoid, one per line<Textarea aria-label="Exclusions" value={draft.exclusions} onChange={(e) => setDraft({ ...draft, exclusions: e.target.value })} /></label>
          <div className="flex gap-2"><Button variant="primary" disabled={state === "saving"} onClick={() => void saveEdit()}>Save brief</Button><Button onClick={() => setEditing(false)}>Cancel</Button></div>
        </div>
      ) : null}
    </Surface>
  );
}
