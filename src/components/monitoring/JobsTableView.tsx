"use client";

import { useEffect, useMemo, useState } from "react";
import type { JobSummary } from "@/components/jobTypes";
import { Button } from "@/components/dashboard/Button";
import { Select, TextInput } from "@/components/dashboard/Controls";
import { DataShell } from "@/components/dashboard/DataShell";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "@/components/dashboard/SystemState";
import type { AttentionItem } from "@/lib/operations/attention";
import type { JobShell } from "@/lib/operations/jobShell";

interface OperationalSnapshot {
  snapshotSequence: number;
  jobs: Record<string, JobShell>;
  attention: Record<string, AttentionItem>;
}

export default function JobsTableView({ onOpenJob }: { onOpenJob?: (id: string) => void }) {
  const [jobs, setJobs] = useState<JobSummary[] | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [sortDesc, setSortDesc] = useState(true);
  const [q, setQ] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [operations, setOperations] = useState<OperationalSnapshot | null>(null);
  const [controlError, setControlError] = useState("");
  const [busyJob, setBusyJob] = useState("");

  useEffect(() => {
    const t = setTimeout(() => {
      fetch("/api/jobs", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
        .then((d) => { setJobs(d.jobs); setError(""); })
        .catch((cause) => setError(cause instanceof Error ? cause.message : "Jobs request failed"));
    }, 0);
    return () => clearTimeout(t);
  }, [reload]);

  useEffect(() => {
    let stopped = false;
    let cursor = -1;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/operations/shell?after=${cursor}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Operational feed HTTP ${response.status}`);
        const data = await response.json() as { snapshot: OperationalSnapshot };
        if (!stopped) {
          setOperations(data.snapshot);
          cursor = data.snapshot.snapshotSequence;
          timer = setTimeout(refresh, 5_000);
        }
      } catch (cause) {
        if (!stopped) {
          setError(cause instanceof Error ? cause.message : "Operational feed failed");
          timer = setTimeout(refresh, 10_000);
        }
      }
    };
    void refresh();
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [reload]);

  const control = async (shell: JobShell, action: "pause" | "resume" | "cancel") => {
    const confirmation = action === "cancel" ? window.prompt(`Type CANCEL ${shell.jobId} to confirm cancellation.`) : undefined;
    if (action === "cancel" && confirmation !== `CANCEL ${shell.jobId}`) return;
    setBusyJob(shell.jobId);
    setControlError("");
    try {
      const response = await fetch(`/api/jobs/${encodeURIComponent(shell.jobId)}/control`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ commandId: crypto.randomUUID(), action, expectedControlEpoch: shell.controlEpoch, ...(confirmation ? { confirmation } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.receipt?.error ?? data.error ?? `Control HTTP ${response.status}`);
      setReload((value) => value + 1);
    } catch (cause) {
      setControlError(cause instanceof Error ? cause.message : "Job control failed");
    } finally {
      setBusyJob("");
    }
  };

  const rows = useMemo(() => {
    let out = jobs ?? [];
    if (statusFilter) out = out.filter((j) => j.status === statusFilter);
    if (q) {
      const needle = q.toLowerCase();
      out = out.filter(
        (j) =>
          j.id.toLowerCase().includes(needle) ||
          j.config.sourceManifestId.toLowerCase().includes(needle) ||
          j.config.desiredOutputs.some((output) => output.includes(needle)),
      );
    }
    return [...out].sort((a, b) =>
      sortDesc
        ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
        : Date.parse(a.createdAt) - Date.parse(b.createdAt),
    );
  }, [jobs, statusFilter, sortDesc, q]);

  return (
    <div className="ops-stack">
      <DataShell title="Needs you" description="One inbox for approvals, policy decisions, credentials, missing assets, budget gates, and uncertain external effects.">
        {!operations ? <LoadingState title="Loading operator inbox" /> : Object.values(operations.attention).length === 0 ? <EmptyState title="Nothing needs attention" message="Background work can continue without an operator decision." /> : <div className="ops-stack">
          {Object.values(operations.attention).map((item) => (
            <a className="dash-alert" data-tone={item.priority >= 90 ? "danger" : "warning"} href={item.actionHref} key={item.id}>
              <strong>{item.title}</strong> — {item.reason}
            </a>
          ))}
        </div>}
      </DataShell>
      {controlError && <ErrorState title="Job control was rejected" message={controlError} />}
      <div className="ops-filter-row">
        <TextInput aria-label="Search jobs"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search job, manifest, or output…"
        />
        <Select aria-label="Filter jobs by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">all statuses</option>
          <option value="running">running</option>
          <option value="waiting_for_approval">waiting for approval</option>
          <option value="complete">complete</option>
          <option value="failed">failed</option>
        </Select>
        <Button variant="quiet"
          onClick={() => setSortDesc((d) => !d)}
        >
          created {sortDesc ? "↓ newest first" : "↑ oldest first"}
        </Button>
        <span className="monitor-result-count">{rows.length} job(s)</span>
      </div>

      {error ? <ErrorState title="Jobs could not be loaded" message={error} action={<Button onClick={() => setReload((value) => value + 1)}>Retry</Button>} /> : jobs === null ? <LoadingState title="Loading jobs" /> : rows.length === 0 ? <EmptyState title="No jobs match" message="Change the search or status filter to widen the query." /> : <DataShell>
        <table className="ops-table">
          <thead>
            <tr>
              <th>Job</th><th>Source</th><th>Stage</th><th>Lifecycle</th><th>Progress</th><th>Control</th><th>Created</th><th>Failure</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((j) => (
              (() => {
              const shell = operations?.jobs[j.id];
              return (
              <tr
                key={j.id}
                onClick={() => onOpenJob?.(j.id)}
                className={onOpenJob ? "ops-table__interactive-row" : undefined}
              >
                <td className="px-3 py-2 font-mono">{j.id.slice(0, 16)}</td>
                <td className="max-w-[220px] truncate px-3 py-2">
                  {j.sourceAnalysis?.summary ?? `Bundle ${j.config.sourceManifestId.slice(0, 12)}`}
                </td>
                <td className="px-3 py-2 capitalize">{j.stage.replace("_", " ")}</td>
                <td className="px-3 py-2">
                  <StatusBadge tone={shell?.lifecycle === "settled" ? "success" : shell?.lifecycle === "failed" || shell?.lifecycle === "uncertain" ? "danger" : shell?.needsAttention || shell?.lifecycle === "paused" ? "warning" : "info"}>
                    {(shell?.lifecycle ?? j.status).replaceAll("_", " ")}
                  </StatusBadge>
                </td>
                <td className="ops-table__muted">{shell ? `${shell.progress.completedSteps}/${shell.progress.totalSteps}` : "—"}</td>
                <td onClick={(event) => event.stopPropagation()}>
                  {shell && shell.lifecycle !== "settled" ? shell.controlState === "cancelled" ? <StatusBadge tone="warning">Cancelled</StatusBadge> : <div className="ops-filter-row">
                    <Button variant="quiet" busy={busyJob === j.id} onClick={() => void control(shell, shell.controlState === "paused" ? "resume" : "pause")}>{shell.controlState === "paused" ? "Resume" : "Pause"}</Button>
                    <Button variant="danger" busy={busyJob === j.id} onClick={() => void control(shell, "cancel")}>Cancel</Button>
                  </div> : "—"}
                </td>
                <td className="ops-table__muted">
                  {new Date(j.createdAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
                </td>
                <td className={j.failure ? "ops-table__danger" : "ops-table__muted"} title={j.failure?.publicMessage}>
                  {j.failure ? `${j.failure.stage}: ${j.failure.publicMessage.slice(0, 60)}` : "—"}
                </td>
              </tr>
              );
              })()
            ))}
          </tbody>
        </table>
      </DataShell>}
    </div>
  );
}
