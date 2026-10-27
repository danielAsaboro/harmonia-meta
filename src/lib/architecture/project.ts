import type { ArchitectureDefinition, ArchitectureEdge, ArchitectureNode } from "./schema";
import type { ExplorerState } from "./explorerState";

export interface ArchitectureProjection { nodes: ArchitectureNode[]; edges: ArchitectureEdge[]; matchIds: string[]; }

export function searchArchitecture(definition: ArchitectureDefinition, query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  return definition.nodes.filter((node) => [node.name, node.summary, node.model?.name, node.promptResponsibility, ...(node.representativeRoutes ?? []), ...(node.tools ?? []), ...(node.skills ?? [])].filter(Boolean).join(" ").toLowerCase().includes(needle)).map((node) => node.id);
}

export function projectArchitecture(definition: ArchitectureDefinition, state: ExplorerState): ArchitectureProjection {
  const byId = new Map(definition.nodes.map((node) => [node.id, node]));
  const matches = new Set(searchArchitecture(definition, state.query));
  const forced = new Set<string>();
  for (const match of matches) {
    let cursor = byId.get(match);
    while (cursor) { forced.add(cursor.id); cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined; }
  }
  const expanded = new Set([...state.expanded, ...[...forced].filter((id) => byId.get(id)?.kind === "group")]);
  const layerPass = (node: ArchitectureNode) => !state.layers.length || state.layers.includes(node.layer);
  const statusPass = (node: ArchitectureNode) => !state.statuses.length || node.statuses.some((status) => state.statuses.includes(status));
  const visible = (node: ArchitectureNode) => {
    if (!layerPass(node) || !statusPass(node)) return false;
    if (state.query && !forced.has(node.id)) return false;
    let cursor = node.parentId ? byId.get(node.parentId) : undefined;
    while (cursor) {
      if (!expanded.has(cursor.id)) return false;
      cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    }
    return true;
  };
  const nodes = definition.nodes.filter(visible);
  const visibleIds = new Set(nodes.map((node) => node.id));
  const nearest = (id: string): string | undefined => {
    let cursor = byId.get(id);
    while (cursor && !visibleIds.has(cursor.id)) cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
    return cursor?.id;
  };
  const dedupe = new Set<string>();
  const edges: ArchitectureEdge[] = [];
  for (const edge of definition.edges) {
    const source = nearest(edge.source); const target = nearest(edge.target);
    if (!source || !target || source === target) continue;
    const key = `${source}:${target}:${edge.kind}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key); edges.push({ ...edge, id: key, source, target });
  }
  return { nodes, edges, matchIds: [...matches] };
}
