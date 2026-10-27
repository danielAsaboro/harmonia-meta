import type { ArchitectureDefinition, ArchitectureLayer, ArchitectureStatus } from "./schema";

export interface ExplorerState {
  presetId: string;
  selectedNodeId?: string;
  expanded: string[];
  layers: ArchitectureLayer[];
  statuses: ArchitectureStatus[];
  query: string;
}

export function createDefaultExplorerState(definition: ArchitectureDefinition): ExplorerState {
  const preset = definition.presets.find((item) => item.id === "overview") ?? definition.presets[0];
  return { presetId: preset.id, expanded: [...preset.expanded], layers: [...preset.layers], statuses: [...preset.statuses], query: "" };
}

const csv = (value: string | null) => value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];

export function parseExplorerQuery(params: URLSearchParams, definition: ArchitectureDefinition): ExplorerState {
  const base = createDefaultExplorerState(definition);
  const nodeIds = new Set(definition.nodes.map((node) => node.id));
  const groupIds = new Set(definition.nodes.filter((node) => node.kind === "group").map((node) => node.id));
  const layerIds = new Set<string>(definition.nodes.map((node) => node.layer));
  const statusIds = new Set<string>(definition.nodes.flatMap((node) => node.statuses));
  const presetId = definition.presets.some((preset) => preset.id === params.get("preset")) ? params.get("preset")! : base.presetId;
  const preset = definition.presets.find((item) => item.id === presetId)!;
  return {
    presetId,
    selectedNodeId: nodeIds.has(params.get("node") ?? "") ? params.get("node")! : undefined,
    expanded: (params.has("expanded") ? csv(params.get("expanded")) : preset.expanded).filter((id) => groupIds.has(id)).sort(),
    layers: (params.has("layers") ? csv(params.get("layers")) : preset.layers).filter((id) => layerIds.has(id)) as ArchitectureLayer[],
    statuses: (params.has("statuses") ? csv(params.get("statuses")) : preset.statuses).filter((id) => statusIds.has(id)) as ArchitectureStatus[],
    query: params.get("q")?.trim() ?? "",
  };
}

export function serializeExplorerQuery(state: ExplorerState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.presetId) params.set("preset", state.presetId);
  if (state.selectedNodeId) params.set("node", state.selectedNodeId);
  params.set("expanded", [...state.expanded].sort().join(","));
  if (state.layers.length) params.set("layers", [...state.layers].sort().join(","));
  if (state.statuses.length) params.set("statuses", [...state.statuses].sort().join(","));
  if (state.query) params.set("q", state.query);
  return params;
}

export function applyPreset(state: ExplorerState, presetId: string, definition: ArchitectureDefinition): ExplorerState {
  const preset = definition.presets.find((item) => item.id === presetId);
  if (!preset) return state;
  return { ...state, presetId, selectedNodeId: preset.focusNodeIds[0], expanded: [...preset.expanded], layers: [...preset.layers], statuses: [...preset.statuses], query: "" };
}

export function toggleGroup(state: ExplorerState, groupId: string): ExplorerState {
  const expanded = new Set(state.expanded);
  if (expanded.has(groupId)) expanded.delete(groupId); else expanded.add(groupId);
  return { ...state, expanded: [...expanded].sort() };
}

export function activateNode(state: ExplorerState, nodeId: string, definition: ArchitectureDefinition): ExplorerState {
  const node = definition.nodes.find((item) => item.id === nodeId);
  const selected = { ...state, selectedNodeId: nodeId };
  return node?.kind === "group" ? toggleGroup(selected, nodeId) : selected;
}
