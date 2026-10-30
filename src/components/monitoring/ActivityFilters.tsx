import type { ActivityFiltersState } from "./AgentActivityView";
import { Select, TextInput } from "@/components/dashboard/Controls";
import { Surface } from "@/components/dashboard/Surface";

const agents = ["nimi_analyst", "ryan_strategist", "temi_editorial_planner", "noni_copywriter", "dara_editor", "maya_renderer", "nova_liaison"];
export default function ActivityFilters({ filters, onChange }: { filters: ActivityFiltersState; onChange: (next: ActivityFiltersState) => void }) {
  const set = <K extends keyof ActivityFiltersState>(key: K, value: ActivityFiltersState[K]) => onChange({ ...filters, [key]: value });
  return <Surface className="activity-filters">
    <TextInput aria-label="Search activity" className="sm:col-span-2" placeholder="Search safe IDs and labels" value={filters.q} onChange={(e) => set("q", e.target.value)} />
    <Select aria-label="Agent" value={filters.agent} onChange={(e) => set("agent", e.target.value)}><option value="">All agents</option>{agents.map((v) => <option key={v}>{v}</option>)}</Select>
    <TextInput aria-label="Stage" placeholder="Stage" value={filters.stage} onChange={(e) => set("stage", e.target.value)} />
    <Select aria-label="Outcome" value={filters.outcome} onChange={(e) => set("outcome", e.target.value)}><option value="">All outcomes</option><option>success</option><option>error</option></Select>
    <Select aria-label="Severity" value={filters.severity} onChange={(e) => set("severity", e.target.value)}><option value="">All severities</option>{["debug", "info", "warning", "error"].map((v) => <option key={v}>{v}</option>)}</Select>
    <TextInput aria-label="Model" placeholder="Model" value={filters.model} onChange={(e) => set("model", e.target.value)} />
    <TextInput aria-label="Tool" placeholder="Tool" value={filters.tool} onChange={(e) => set("tool", e.target.value)} />
    <TextInput aria-label="Job ID" placeholder="Job ID" value={filters.jobId} onChange={(e) => set("jobId", e.target.value)} />
    <TextInput aria-label="Trace ID" placeholder="Trace ID" value={filters.traceId} onChange={(e) => set("traceId", e.target.value)} />
    <label>Since<TextInput type="datetime-local" value={filters.since} onChange={(e) => set("since", e.target.value)} /></label>
    <label>Until<TextInput type="datetime-local" value={filters.until} onChange={(e) => set("until", e.target.value)} /></label>
  </Surface>;
}
