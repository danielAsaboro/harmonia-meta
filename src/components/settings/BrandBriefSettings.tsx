"use client";

import { useState } from "react";
import { BriefSummary } from "@/components/onboarding/BriefSummary";
import { ShareBriefButton } from "@/components/onboarding/ShareBriefButton";
import { OnboardingStepper } from "@/components/onboarding/OnboardingStepper";
import { useWebsiteOnboarding } from "@/hooks/useWebsiteOnboarding";
import { apiFetch } from "@/lib/clientApi";
import { Button } from "@/components/dashboard/Button";
import { Textarea, TextInput } from "@/components/dashboard/Controls";
import { SectionHeader } from "@/components/dashboard/DashboardPage";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Surface } from "@/components/dashboard/Surface";

const lines = (value: string) => value.split("\n").map((line) => line.trim()).filter(Boolean);

export function BrandBriefSettings() {
  const { brief, setBrief, run, error, start } = useWebsiteOnboarding();
  const [url, setUrl] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState({ positioning: "", voice: "", exclusions: "", audiences: [] as Array<{ id: string; name: string; pains: string }> });

  const building = run?.status === "running";

  async function build() {
    setMessage("");
    await start(url.trim());
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

  return (
    <Surface as="section" className="settings-section settings-section--strategy">
      <SectionHeader title="Brand brief" description="Give Harmonia your website once. It reads the site, researches competitors and customer pain with Meta web search, and every job starts from this brief."
        metadata={<StatusBadge tone={state === "error" || run?.status === "failed" ? "danger" : building ? "info" : brief ? "success" : "neutral"}>{building ? "Building" : brief ? (brief.editedAt ? "Edited" : "Active") : "Not set"}</StatusBadge>} />
      <div className="mt-3 flex gap-2">
        <TextInput aria-label="Company website" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url.trim() && void build()} placeholder={brief ? `Rebuild from a site (current: ${brief.website})` : "yourcompany.com"} />
        <Button variant="primary" disabled={!url.trim() || building} onClick={() => void build()}>{building ? "Building…" : brief ? "Rebuild" : "Build brief"}</Button>
      </div>
      {error ? <p className="mt-2 text-xs" role="alert">{error}</p> : null}
      {message ? <p className="mt-2 text-xs" role={state === "error" ? "alert" : "status"}>{message}</p> : null}
      {run && (building || run.status === "failed") ? (
        <div className="mt-4">
          <OnboardingStepper run={run} />
          {run.status === "failed" ? <p className="mt-2 text-xs text-red-700" role="alert">{run.error}</p> : null}
        </div>
      ) : null}

      {brief && !editing && !building ? (
        <div className="mt-4 space-y-4">
          <BriefSummary brief={brief} />
          <div className="flex flex-wrap items-center gap-2"><Button onClick={startEdit}>Edit brief</Button><ShareBriefButton className="dash-button dash-button--secondary" /></div>
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
