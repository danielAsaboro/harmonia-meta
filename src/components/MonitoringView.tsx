"use client";

import { useCallback, useEffect, useState } from "react";
import type { MetricsResponse } from "@/app/api/metrics/route";
import { Button } from "@/components/dashboard/Button";
import { ErrorState, LoadingState } from "@/components/dashboard/SystemState";

const STAGE_ORDER = [
  "queued", "collect_sources", "extract_sources", "awaiting_source_resolution", "understand", "strategize", "awaiting_strategy_approval",
  "plan", "draft", "awaiting_approval", "publish", "verify", "learn", "packet", "complete",
];

const STAGE_COLORS: Record<string, string> = {
  complete: "#10b981",
  failed: "#ef4444",
  awaiting_approval: "#f59e0b",
  awaiting_strategy_approval: "#f59e0b",
  strategize: "#8b5cf6",
  plan: "#2563eb",
};

function stageColor(stage: string): string {
  return STAGE_COLORS[stage] ?? "#71717a";
}

function fmtDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}m`;
  return `${(sec / 3600).toFixed(1)}h`;
}

function PipelineFlow({ stages }: { stages: MetricsResponse["stages"] }) {
  const counts = new Map(stages.map((s) => [s.stage, s.count]));
  const max = Math.max(1, ...stages.map((s) => s.count));
  const ordered = STAGE_ORDER.map((stage) => ({ stage, count: counts.get(stage) ?? 0 }));
  const totalJobs = ordered.reduce((a, b) => a + b.count, 0);

  return (
    <div className="dash-surface monitor-card monitor-card--wide-data">
      <h3 className="mb-4 text-sm font-semibold">Pipeline flow — jobs per stage</h3>
      <svg viewBox={`0 0 ${ordered.length * 72} 150`} className="w-full" role="img" aria-label="Jobs per pipeline stage">
        {ordered.map((s, i) => {
          const h = (s.count / max) * 90;
          const x = i * 72 + 14;
          const y = 110 - h;
          const color = stageColor(s.stage);
          return (
            <g key={s.stage}>
              <rect x={x} y={y} width={44} height={Math.max(h, s.count > 0 ? 3 : 0)} rx={3} fill={color} opacity={0.85} />
              {s.count > 0 && (
                <text x={x + 22} y={y - 5} textAnchor="middle" fontSize="11" className="fill-zinc-600 dark:fill-zinc-300">
                  {s.count}
                </text>
              )}
              <text x={x + 22} y={128} textAnchor="middle" fontSize="8.5" className="fill-zinc-500 dark:fill-zinc-400">
                {s.stage.replace("_", " ")}
              </text>
              {i < ordered.length - 1 && (
                <path
                  d={`M ${x + 48} 105 q 12 -6 24 -12`}
                  stroke="currentColor"
                  className="text-zinc-300 dark:text-zinc-700"
                  fill="none"
                  strokeWidth="1.2"
                  strokeDasharray="3 3"
                />
              )}
            </g>
          );
        })}
        <text x={4} y={145} fontSize="9" className="fill-zinc-400">{totalJobs} job(s) tracked</text>
      </svg>
    </div>
  );
}

function StatusDonut({ totals }: { totals: MetricsResponse["totals"] }) {
  const parts = [
    { label: "running", value: totals.running, color: "#3b82f6" },
    { label: "awaiting approval", value: totals.waiting_for_approval, color: "#f59e0b" },
    { label: "complete", value: totals.complete, color: "#10b981" },
    { label: "failed", value: totals.failed, color: "#ef4444" },
  ].filter((p) => p.value > 0);
  const total = Math.max(1, totals.jobs);
  const R = 52;
  const C = 2 * Math.PI * R;
  let offset = 0;

  return (
    <div className="dash-surface monitor-card">
      <h3 className="mb-4 text-sm font-semibold">Job status</h3>
      <div className="flex items-center gap-5">
        <svg viewBox="0 0 140 140" className="h-32 w-32 shrink-0" role="img" aria-label="Job status distribution">
          <circle cx="70" cy="70" r={R} fill="none" strokeWidth="16" className="stroke-zinc-100 dark:stroke-zinc-900" />
          {parts.map((p) => {
            const frac = p.value / total;
            const dash = `${frac * C} ${C}`;
            const el = (
              <circle
                key={p.label}
                cx="70" cy="70" r={R} fill="none"
                stroke={p.color} strokeWidth="16"
                strokeDasharray={dash}
                strokeDashoffset={-offset * C}
                transform="rotate(-90 70 70)"
              />
            );
            offset += frac;
            return el;
          })}
          <text x="70" y="76" textAnchor="middle" fontSize="22" fontWeight="600" className="fill-zinc-800 dark:fill-zinc-100">
            {totals.jobs}
          </text>
        </svg>
        <ul className="flex flex-col gap-1.5 text-xs">
          {parts.map((p) => (
            <li key={p.label} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: p.color }} />
              <span className="capitalize text-zinc-600 dark:text-zinc-400">{p.label}</span>
              <span className="font-medium">{p.value}</span>
            </li>
          ))}
          {parts.length === 0 && <li className="text-zinc-400">No jobs yet.</li>}
        </ul>
      </div>
    </div>
  );
}

function DwellChart({ dwell }: { dwell: MetricsResponse["stageDwell"] }) {
  const max = Math.max(1, ...dwell.map((d) => d.avgSec));
  return (
    <div className="dash-surface monitor-card">
      <h3 className="mb-1 text-sm font-semibold">Average time in stage</h3>
      <p className="mb-4 text-[11px] text-zinc-400">
        Mean wall-clock dwell derived from stage events of the most recent jobs.
      </p>
      {dwell.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-400">Not enough history yet — run a job first.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {dwell.slice(0, 8).map((d) => (
            <li key={d.stage} className="flex items-center gap-3 text-xs">
              <span className="w-28 shrink-0 truncate capitalize text-zinc-500 dark:text-zinc-400">{d.stage.replace("_", " ")}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                <div
                  className="h-full rounded-full bg-sky-500"
                  style={{ width: `${Math.max(2, (d.avgSec / max) * 100)}%` }}
                />
              </div>
              <span className="w-24 shrink-0 text-right font-mono tabular-nums" title={`avg ${fmtDuration(d.avgSec)} · p50 ${fmtDuration(d.p50Sec)} · p95 ${fmtDuration(d.p95Sec)}`}>
                p50 {fmtDuration(d.p50Sec)} · p95 {fmtDuration(d.p95Sec)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ReceiptStats({ receipts }: { receipts: MetricsResponse["receipts"] }) {
  const items = [
    { label: "applied", value: receipts.applied, color: "text-emerald-600 dark:text-emerald-400" },
    { label: "already applied", value: receipts.already_applied, color: "text-sky-600 dark:text-sky-400" },
    { label: "failed", value: receipts.failed, color: "text-red-600 dark:text-red-400" },
    { label: "rejected", value: receipts.rejected, color: "text-zinc-500" },
  ];
  return (
    <div className="dash-surface monitor-card">
      <h3 className="mb-4 text-sm font-semibold">External action receipts</h3>
      <dl className="grid grid-cols-2 gap-3">
        {items.map((it) => (
          <div key={it.label} className="monitor-metric">
            <dt className="text-[11px] uppercase tracking-wide text-zinc-400">{it.label}</dt>
            <dd className={`mt-0.5 text-xl font-semibold tabular-nums ${it.color}`}>{it.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function ModelCostStats({
  usage,
  costs,
}: {
  usage: MetricsResponse["modelUsage"];
  costs: MetricsResponse["costs"];
}) {
  return (
    <div className="dash-surface monitor-card lg:col-span-2">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Model usage and cost comparison</h3>
          <p className="mt-1 text-[11px] text-zinc-400">
            Versioned application estimates; observed provider charges stay separately labeled.
          </p>
        </div>
        <dl className="flex gap-4 text-right text-xs tabular-nums">
          <div><dt className="text-zinc-400">estimated</dt><dd>${costs.estimatedUsd}</dd></div>
          <div><dt className="text-zinc-400">observed</dt><dd>${costs.observedUsd}</dd></div>
          <div><dt className="text-zinc-400">reserved</dt><dd>${costs.reservedUsd}</dd></div>
        </dl>
      </div>
      {usage.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-400">No finalized model usage yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-zinc-200 text-[10px] uppercase tracking-wide text-zinc-400 dark:border-zinc-800">
              <tr>
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 text-right font-medium">Calls</th>
                <th className="pb-2 text-right font-medium">Input</th>
                <th className="pb-2 text-right font-medium">Output</th>
                <th className="pb-2 text-right font-medium">Estimated</th>
              </tr>
            </thead>
            <tbody>
              {usage.map((item) => (
                <tr key={`${item.model}:${item.role}`} className="border-b border-zinc-100 last:border-0 dark:border-zinc-900">
                  <td className="py-2.5 font-mono">{item.model}</td>
                  <td className="py-2.5 text-zinc-500 dark:text-zinc-400">{item.role}</td>
                  <td className="py-2.5 text-right tabular-nums">{item.calls}</td>
                  <td className="py-2.5 text-right tabular-nums">{item.inputUnits.toLocaleString()}</td>
                  <td className="py-2.5 text-right tabular-nums">{item.outputUnits.toLocaleString()}</td>
                  <td className="py-2.5 text-right font-mono">${item.estimatedCostUsd}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ReliabilityChart({ stats }: { stats: MetricsResponse["stageStats"] }) {
  return (
    <div className="dash-surface monitor-card">
      <h3 className="mb-4 text-sm font-semibold">Stage reliability</h3>
      {stats.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-400">Not enough history yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {stats.map((st) => {
            const pct = Math.round(st.successRate * 100);
            const color = pct >= 90 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
            return (
              <li key={st.stage} className="flex items-center gap-3 text-xs">
                <span className="w-28 shrink-0 truncate capitalize text-zinc-500 dark:text-zinc-400">{st.stage.replace("_", " ")}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-900">
                  <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.max(2, pct)}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right font-mono tabular-nums">{pct}% of {st.reached}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ActivityFeed({ events }: { events: MetricsResponse["recentEvents"] }) {
  return (
    <div className="dash-surface monitor-card">
      <h3 className="mb-4 text-sm font-semibold">Live activity log</h3>
      {events.length === 0 ? (
        <p className="py-6 text-center text-xs text-zinc-400">No events yet.</p>
      ) : (
        <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto font-mono text-[11px] leading-5">
          {events.map((e, i) => (
            <li key={i} className="flex gap-2 border-b border-zinc-100 pb-1.5 last:border-0 dark:border-zinc-900">
              <span className="shrink-0 text-zinc-400">
                {e.at ? new Date(e.at).toLocaleTimeString() : "—"}
              </span>
              <span
                className="shrink-0 rounded px-1.5 font-medium uppercase"
                style={{ background: `${stageColor(e.stage)}22`, color: stageColor(e.stage) }}
              >
                {e.stage}
              </span>
              <span className="min-w-0 flex-1 break-words text-zinc-600 dark:text-zinc-300">
                <span className="text-zinc-400">[{e.actor}]</span> {e.message}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function MonitoringView() {
  const [metrics, setMetrics] = useState<MetricsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/metrics", { cache: "no-store" });
      if (!res.ok) throw new Error(`metrics ${res.status}`);
      setMetrics(await res.json());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const kickoff = setTimeout(() => void load(), 0);
    const t = setInterval(() => {
      if (!document.hidden) void load();
    }, 5000);
    return () => {
      clearTimeout(kickoff);
      clearInterval(t);
    };
  }, [load]);

  if (error) {
    return <ErrorState title="Metrics could not be loaded" message={error} action={<Button onClick={() => void load()}>Retry metrics</Button>} />;
  }
  if (!metrics) {
    return <LoadingState title="Loading operational metrics" message="Reading current pipeline, receipt, reliability, and model-usage state." />;
  }

  return (
    <div className="monitoring-grid">
      <PipelineFlow stages={metrics.stages} />
      <StatusDonut totals={metrics.totals} />
      <DwellChart dwell={metrics.stageDwell} />
      <ReliabilityChart stats={metrics.stageStats} />
      <ReceiptStats receipts={metrics.receipts} />
      <ModelCostStats usage={metrics.modelUsage} costs={metrics.costs} />
      <div className="lg:col-span-2">
        <ActivityFeed events={metrics.recentEvents} />
      </div>
    </div>
  );
}
