"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/dashboard/Button";
import { SectionHeader } from "@/components/dashboard/DashboardPage";
import { Surface } from "@/components/dashboard/Surface";
import { AlertBanner, EmptyState, ErrorState, LoadingState } from "@/components/dashboard/SystemState";

type Row = { id: string; type?: string; state?: string; outcome?: string; scheduledAt?: string; briefing?: string; estimatedCostUsd?: number };
type Data = { provenance: string; cycles: Row[]; agendas: Row[]; experiments: Row[]; revisions: Row[]; attention: Row[] };

export default function AutonomousOperationsView() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    setData(null);
    fetch("/api/autonomy", { cache: "no-store" })
      .then(async (response) => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json(); })
      .then(setData)
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, []);

  useEffect(() => { const timer = setTimeout(load, 0); return () => clearTimeout(timer); }, [load]);

  if (error) return <ErrorState title="Autonomy state unavailable" message={error} action={<Button onClick={load}>Retry autonomy state</Button>} />;
  if (!data) return <LoadingState title="Loading resident autonomy" message="Reading persisted tenant-scoped cycles, agendas, experiments, and attention state." />;

  const cost = data.cycles.reduce((sum, row) => sum + (row.estimatedCostUsd ?? 0), 0);
  const metrics = [["Cycles", data.cycles.length], ["Experiments", data.experiments.length], ["Open attention", data.attention.filter((item) => item.state === "open").length], ["Estimated cost", `$${cost.toFixed(4)}`]];

  return <section className="ops-stack" aria-label="Resident autonomy">
    <AlertBanner tone="warning" title="Autonomy is bounded">
      Resident cycles may observe and propose work within the workspace. Schedules are disabled by default, and external effects still require the existing approval and receipt path.
    </AlertBanner>
    <div className="ops-metrics">{metrics.map(([label, value]) => <Surface key={label} variant="raised" className="ops-metric"><span>{label}</span><strong>{value}</strong></Surface>)}</div>
    <Surface as="section" className="ops-section">
      <SectionHeader title="Resident cycles" description={`Persisted tenant-scoped state · ${data.provenance}`} />
      {data.cycles.length === 0 ? <EmptyState title="No resident cycles have run" message="Schedules are disabled by default; no background action is implied." /> : <ul className="ops-list">{data.cycles.map((cycle) => <li key={cycle.id}><strong>{cycle.type}</strong><span>{cycle.state}</span><p>{cycle.outcome}</p></li>)}</ul>}
    </Surface>
    <Surface as="section" className="ops-section">
      <SectionHeader title="Wakeup agendas" description="Durable briefs for the next bounded resident cycle." />
      {data.agendas.length === 0 ? <EmptyState title="No durable agenda" message="The resident agent has not persisted a wakeup briefing." /> : <div className="ops-list">{data.agendas.map((agenda) => <p key={agenda.id}>{agenda.briefing}</p>)}</div>}
    </Surface>
  </section>;
}
