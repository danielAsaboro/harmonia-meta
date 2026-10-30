import type { AgentActivity } from "@/lib/observability/schema";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Surface } from "@/components/dashboard/Surface";
import { EmptyState } from "@/components/dashboard/SystemState";

function TraceNode({ item, childMap }: { item: AgentActivity; childMap: Map<string, AgentActivity[]> }) {
  return <li className="trace-node">
    <details open={!item.parentSpanId}>
      <summary><span className="font-mono">{item.agent}</span> · {item.eventName} · {item.durationMs} ms <StatusBadge tone={item.outcome === "error" ? "danger" : "success"}>{item.outcome}</StatusBadge></summary>
      <div className="trace-meta"><span>stage: {item.stage}</span><span>span: {item.spanId}</span><span>model: {item.model ?? "—"}</span><span>tool: {item.tool ?? "—"}</span></div>
      {(childMap.get(item.spanId) ?? []).length > 0 && <ul>{childMap.get(item.spanId)!.map((child) => <TraceNode key={child.id} item={child} childMap={childMap} />)}</ul>}
    </details>
  </li>;
}

export default function TraceTree({ records }: { records: AgentActivity[] }) {
  const traces = records.filter((record) => record.signalType === "trace");
  const grouped = new Map<string, AgentActivity[]>();
  for (const trace of traces) grouped.set(trace.traceId, [...(grouped.get(trace.traceId) ?? []), trace]);
  if (!grouped.size) return <EmptyState title="No trace spans match these filters" message="Change or reset the filters to widen the operational query." />;
  return <div className="ops-stack">{[...grouped.entries()].map(([traceId, items]) => {
    const ids = new Set(items.map((item) => item.spanId));
    const children = new Map<string, AgentActivity[]>();
    for (const item of items) if (item.parentSpanId && ids.has(item.parentSpanId)) children.set(item.parentSpanId, [...(children.get(item.parentSpanId) ?? []), item]);
    const roots = items.filter((item) => !item.parentSpanId || !ids.has(item.parentSpanId));
    return <Surface as="section" key={traceId} className="trace-group"><p>trace {traceId}</p><ul>{roots.map((root) => <TraceNode key={root.id} item={root} childMap={children} />)}</ul></Surface>;
  })}</div>;
}
