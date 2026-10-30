"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/dashboard/Button";
import { Select, TextInput } from "@/components/dashboard/Controls";
import { DataShell } from "@/components/dashboard/DataShell";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "@/components/dashboard/SystemState";

interface LogEntry {
  id: string;
  jobId: string;
  at: string | null;
  stage: string;
  message: string;
  actor: string;
}

const STAGES = [
  "collect_sources", "extract_sources", "awaiting_source_resolution", "understand", "strategize", "awaiting_strategy_approval",
  "plan", "draft", "awaiting_approval", "publish", "verify", "learn",
];
const ACTORS = ["system", "agent", "operator"];

function StageChip({ stage }: { stage: string }) {
  const tone = stage === "failed" ? "danger" : stage.includes("awaiting") ? "warning" : stage === "learn" || stage === "verify" ? "success" : "info";
  return <StatusBadge tone={tone}>{stage.replaceAll("_", " ")}</StatusBadge>;
}

export default function LogsView() {
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [stages, setStages] = useState<string[]>([]);
  const [actor, setActor] = useState("");
  const [jobId, setJobId] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    for (const s of stages) params.append("stage", s);
    if (actor) params.set("actor", actor);
    if (jobId) params.set("jobId", jobId);
    try {
      const res = await fetch(`/api/events?${params.toString()}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Event request failed (${res.status})`);
      const d = await res.json();
      setEntries(d.events);
      setTotal(d.total);
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Event request failed");
    }
  }, [q, stages, actor, jobId]);

  useEffect(() => {
    const t = setTimeout(() => void load(), q ? 250 : 0); // debounce typing
    return () => clearTimeout(t);
  }, [load, q]);

  function toggleStage(s: string) {
    setStages((cur) => (cur.includes(s) ? cur.filter((x) => x !== s) : [...cur, s]));
  }

  return (
    <div className="ops-stack">
      <div className="ops-filter-row">
        <TextInput
          aria-label="Search events"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search messages or job ids…"
        />
        <Select aria-label="Filter by actor"
          value={actor}
          onChange={(e) => setActor(e.target.value)}
        >
          <option value="">all actors</option>
          {ACTORS.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
        <TextInput aria-label="Filter by job ID"
          value={jobId}
          onChange={(e) => setJobId(e.target.value)}
          placeholder="filter by job id"
        />
      </div>

      <div className="ops-chip-row">
        <Button variant={stages.length === 0 ? "primary" : "quiet"}
          onClick={() => setStages([])}
        >
          all stages
        </Button>
        {STAGES.map((s) => (
          <Button variant={stages.includes(s) ? "primary" : "quiet"}
            key={s}
            onClick={() => toggleStage(s)}
          >
            {s.replace("_", " ")}
          </Button>
        ))}
        <span className="monitor-result-count">{total} matching event(s)</span>
      </div>

      {error ? <ErrorState title="Event log could not be loaded" message={error} action={<Button onClick={() => void load()}>Retry</Button>} /> : <DataShell>
        {entries === null ? (
          <LoadingState title="Loading event log" />
        ) : entries.length === 0 ? (
          <EmptyState title="No events match these filters" message="Change the filters to widen the event query." />
        ) : (
          <ul className="event-log-list">
            {entries.map((e) => (
              <li key={e.id}>
                <span className="event-log-list__time">
                  {e.at ? new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"}
                </span>
                <StageChip stage={e.stage} />
                <span className="event-log-list__message">
                  <span className="event-log-list__actor">[{e.actor}]</span> {e.message}
                </span>
                <Button variant="quiet"
                  onClick={() => setJobId(e.jobId === jobId ? "" : e.jobId)}
                  title="Filter by this job"
                >
                  {e.jobId.slice(0, 12)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DataShell>}
    </div>
  );
}
