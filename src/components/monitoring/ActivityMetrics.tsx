import type { AgentActivity } from "@/lib/observability/schema";
import { DataShell } from "@/components/dashboard/DataShell";
import { Surface } from "@/components/dashboard/Surface";
import { EmptyState } from "@/components/dashboard/SystemState";

export interface AgentMetricSummary {
  agent: string;
  invocations: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  inferenceCalls: number;
  toolCalls: number;
  p50Ms: number;
  p95Ms: number;
}

export interface ActivitySummary {
  totalInvocations: number;
  failures: number;
  successRate: number;
  agents: AgentMetricSummary[];
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))];
}

export function summarizeActivity(records: AgentActivity[]): ActivitySummary {
  const metrics = records.filter((record) => record.signalType === "metric");
  const groups = new Map<string, AgentActivity[]>();
  for (const metric of metrics) {
    groups.set(metric.agent, [...(groups.get(metric.agent) ?? []), metric]);
  }
  const agents = [...groups.entries()].map(([agent, items]) => ({
    agent,
    invocations: items.length,
    failures: items.filter((item) => item.outcome === "error").length,
    inputTokens: items.reduce((total, item) => total + item.inputTokens, 0),
    outputTokens: items.reduce((total, item) => total + item.outputTokens, 0),
    inferenceCalls: items.reduce((total, item) => total + item.inferenceCalls, 0),
    toolCalls: items.reduce((total, item) => total + item.toolCalls, 0),
    p50Ms: percentile(items.map((item) => item.durationMs), 0.5),
    p95Ms: percentile(items.map((item) => item.durationMs), 0.95),
  })).sort((a, b) => b.invocations - a.invocations || a.agent.localeCompare(b.agent));
  const failures = metrics.filter((metric) => metric.outcome === "error").length;
  return {
    totalInvocations: metrics.length,
    failures,
    successRate: metrics.length ? (metrics.length - failures) / metrics.length : 0,
    agents,
  };
}

export default function ActivityMetrics({ records }: { records: AgentActivity[] }) {
  const summary = summarizeActivity(records);
  if (!summary.totalInvocations) return <EmptyState title="No metrics match these filters" message="Change or reset the filters to widen the operational query." />;
  return (
    <div className="ops-stack">
      <p className="dash-supporting-copy">Aggregates cover the current filtered page.</p>
      <div className="ops-metrics">
        <Metric label="Invocations" value={summary.totalInvocations.toLocaleString()} />
        <Metric label="Success rate" value={`${(summary.successRate * 100).toFixed(1)}%`} />
        <Metric label="Failures" value={summary.failures.toLocaleString()} />
      </div>
      <DataShell><table className="ops-table">
          <thead><tr>{["Agent", "Calls", "Errors", "p50", "p95", "Tokens in/out", "Tools"].map((h) => <th key={h}>{h}</th>)}</tr></thead>
          <tbody>{summary.agents.map((agent) => <tr key={agent.agent}>
            <td className="font-mono">{agent.agent}</td><td>{agent.invocations}</td><td>{agent.failures}</td>
            <td>{agent.p50Ms} ms</td><td>{agent.p95Ms} ms</td><td>{agent.inputTokens}/{agent.outputTokens}</td><td>{agent.toolCalls}</td>
          </tr>)}</tbody>
        </table></DataShell>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <Surface className="ops-metric"><p>{label}</p><strong>{value}</strong></Surface>;
}
