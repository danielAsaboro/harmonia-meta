"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AgentActivity, ObservabilityPage } from "@/lib/observability/schema";
import ActivityFilters from "./ActivityFilters";
import ActivityMetrics from "./ActivityMetrics";
import TraceTree from "./TraceTree";
import { Button } from "@/components/dashboard/Button";
import { DataShell } from "@/components/dashboard/DataShell";
import { SectionHeader } from "@/components/dashboard/DashboardPage";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { EmptyState, ErrorState, LoadingState } from "@/components/dashboard/SystemState";
import { Tabs } from "@/components/dashboard/Tabs";

type SignalType = "log" | "trace" | "metric";
export interface ActivityFiltersState { types: SignalType[]; agent: string; stage: string; outcome: string; severity: string; model: string; tool: string; jobId: string; traceId: string; since: string; until: string; q: string; }
export interface ActivityPagination { cursor: string | null; history: Array<string | null>; }
export const emptyActivityFilters = (): ActivityFiltersState => ({ types: [], agent: "", stage: "", outcome: "", severity: "", model: "", tool: "", jobId: "", traceId: "", since: "", until: "", q: "" });
export const resetPagination = (_pagination: ActivityPagination): ActivityPagination => ({ cursor: null, history: [] });

export function parseActivityFilters(params: URLSearchParams): ActivityFiltersState {
  const empty = emptyActivityFilters();
  const types = params.getAll("type").filter((value): value is SignalType => value === "log" || value === "trace" || value === "metric");
  return {
    ...empty,
    types,
    agent: params.get("agent") ?? "",
    stage: params.get("stage") ?? "",
    outcome: params.get("outcome") ?? "",
    severity: params.get("severity") ?? "",
    model: params.get("model") ?? "",
    tool: params.get("tool") ?? "",
    jobId: params.get("jobId") ?? "",
    traceId: params.get("traceId") ?? "",
    since: params.get("since")?.slice(0, 16) ?? "",
    until: params.get("until")?.slice(0, 16) ?? "",
    q: params.get("q") ?? "",
  };
}

export function buildActivityQuery(filters: ActivityFiltersState, cursor: string | null): URLSearchParams {
  const query = new URLSearchParams({ limit: "25" });
  for (const type of filters.types) query.append("type", type);
  for (const key of ["agent", "stage", "outcome", "severity", "model", "tool", "jobId", "traceId", "q"] as const) if (filters[key]) query.set(key, filters[key]);
  for (const key of ["since", "until"] as const) if (filters[key]) query.set(key, new Date(filters[key]).toISOString());
  if (cursor) query.set("cursor", cursor);
  return query;
}

const modes: Array<{ label: string; type: SignalType }> = [{ label: "Logs", type: "log" }, { label: "Traces", type: "trace" }, { label: "Metrics", type: "metric" }];

export default function AgentActivityView() {
  const [filters, setFilters] = useState<ActivityFiltersState>(() => typeof window === "undefined" ? emptyActivityFilters() : parseActivityFilters(new URL(window.location.href).searchParams));
  const [pagination, setPagination] = useState<ActivityPagination>({ cursor: null, history: [] });
  const [page, setPage] = useState<ObservabilityPage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const query = useMemo(() => buildActivityQuery(filters, pagination.cursor).toString(), [filters, pagination.cursor]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError(null);
      try {
        const response = await fetch(`/api/observability?${query}`, { signal: controller.signal });
        if (!response.ok) throw new Error(`Activity request failed (${response.status})`);
        setPage(await response.json() as ObservabilityPage);
        const url = new URL(window.location.href);
        for (const key of ["type", "agent", "stage", "outcome", "severity", "model", "tool", "jobId", "traceId", "since", "until", "q"]) url.searchParams.delete(key);
        const shareable = buildActivityQuery(filters, null); shareable.delete("limit");
        shareable.forEach((value, key) => url.searchParams.append(key, value));
        url.searchParams.set("tab", "activity");
        window.history.replaceState(null, "", url);
      } catch (cause) { if (!(cause instanceof DOMException && cause.name === "AbortError")) setError(cause instanceof Error ? cause.message : "Activity request failed"); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, filters.q ? 250 : 0);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, filters]);

  const changeFilters = useCallback((next: ActivityFiltersState) => { setFilters(next); setPagination(resetPagination); }, []);
  const selectMode = (type: SignalType) => changeFilters({ ...filters, types: [type] });
  const items = page?.items ?? [];

  return <section className="ops-stack">
    <SectionHeader title="Agent activity" description="Safe operational metadata only. Prompt and response content is never stored here." actions={<Tabs items={modes.map((mode) => ({ key: mode.type, label: mode.label }))} selected={filters.types[0] ?? "log"} onSelect={selectMode} label="Activity signal type" />} />
    <ActivityFilters filters={filters} onChange={changeFilters} />
    <div className="activity-actions"><Button variant="quiet" onClick={() => changeFilters(emptyActivityFilters())}>Reset filters</Button></div>
    {error && <ErrorState title="Agent activity could not be loaded" message={error} action={<Button onClick={() => setPagination((value) => ({ ...value }))}>Retry</Button>} />}
    {loading ? <LoadingState title="Loading agent activity" /> : filters.types[0] === "metric" && filters.types.length === 1 ? <ActivityMetrics records={items} /> : filters.types[0] === "trace" && filters.types.length === 1 ? <TraceTree records={items} /> : <ActivityTable records={items} />}
    <div className="activity-pagination"><span>{items.length} records on this page</span><div><Button disabled={!pagination.history.length || loading} onClick={() => setPagination((current) => ({ cursor: current.history.at(-1) ?? null, history: current.history.slice(0, -1) }))}>Previous</Button><Button disabled={!page?.hasMore || !page.nextCursor || loading} onClick={() => setPagination((current) => ({ cursor: page!.nextCursor, history: [...current.history, current.cursor] }))}>Next</Button></div></div>
  </section>;
}

function ActivityTable({ records }: { records: AgentActivity[] }) {
  if (!records.length) return <EmptyState title="No activity matches these filters" message="Change or reset the filters to widen the operational query." />;
  return <DataShell><table className="ops-table"><thead><tr>{["Time", "Signal", "Agent / stage", "Event", "Outcome", "Duration", "Details"].map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{records.map((item) => <tr key={item.id}><td>{new Date(item.occurredAt).toLocaleString()}</td><td>{item.signalType}</td><td><span className="font-mono">{item.agent}</span><br/><span>{item.stage}</span></td><td>{item.eventName}</td><td><StatusBadge tone={item.outcome === "error" ? "danger" : "success"}>{item.outcome}</StatusBadge></td><td>{item.durationMs} ms</td><td><details><summary>Inspect</summary><pre>{JSON.stringify(item, null, 2)}</pre></details></td></tr>)}</tbody></table></DataShell>;
}
