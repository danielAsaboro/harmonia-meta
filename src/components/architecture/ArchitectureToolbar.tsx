import type { ArchitectureDefinition, ArchitectureLayer, ArchitectureStatus } from "@/lib/architecture/schema";
import type { ExplorerState } from "@/lib/architecture/explorerState";

interface Props { definition: ArchitectureDefinition; state: ExplorerState; onChange: (state: ExplorerState) => void; onPreset: (id: string) => void; onExpandAll: () => void; onCollapseAll: () => void; onFit: () => void; }
export function ArchitectureToolbar({ definition, state, onChange, onPreset, onExpandAll, onCollapseAll, onFit }: Props) {
  const layers = [...new Set(definition.nodes.map((node) => node.layer))];
  const statuses = [...new Set(definition.nodes.flatMap((node) => node.statuses))];
  const toggle = <T extends string>(items: T[], value: T) => items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
  return <header className="arch-toolbar">
    <div className="arch-toolbar__title"><p>System atlas · repository-backed</p><h1>Architecture Explorer</h1></div>
    <label className="arch-search"><span>Search</span><input aria-label="Search architecture" value={state.query} onChange={(event) => onChange({ ...state, query: event.target.value })} placeholder="Agent, model, route, tool…" /></label>
    <label><span className="sr-only">Preset view</span><select aria-label="Preset view" value={state.presetId} onChange={(event) => onPreset(event.target.value)}>{definition.presets.map((preset) => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></label>
    <div className="arch-toolbar__actions"><button type="button" onClick={onExpandAll}>Expand all</button><button type="button" onClick={onCollapseAll}>Collapse all</button><button type="button" onClick={onFit}>Fit view</button></div>
    <details className="arch-filters"><summary>Filters</summary><fieldset><legend>Layers</legend>{layers.map((layer) => <label key={layer}><input type="checkbox" checked={state.layers.includes(layer)} onChange={() => onChange({ ...state, layers: toggle(state.layers, layer as ArchitectureLayer) })} /> {layer}</label>)}</fieldset><fieldset><legend>Status</legend>{statuses.map((status) => <label key={status}><input type="checkbox" checked={state.statuses.includes(status)} onChange={() => onChange({ ...state, statuses: toggle(state.statuses, status as ArchitectureStatus) })} /> {status}</label>)}</fieldset></details>
  </header>;
}
