import ELK from "elkjs/lib/elk.bundled.js";
import type { Edge, Node } from "@xyflow/react";
import type { ArchitectureProjection } from "./project";

export type LayoutProfile = "desktop" | "compact";
export interface LayoutResult { nodes: Node[]; edges: Edge[]; width: number; height: number; }
const elk = new ELK();
const cache = new Map<string, Promise<LayoutResult>>();

export function layoutCacheKey(projection: ArchitectureProjection, profile: LayoutProfile) {
  return `${profile}|${projection.nodes.map((node) => node.id).sort().join(",")}|${projection.edges.map((edge) => edge.id).sort().join(",")}`;
}

export function layoutArchitecture(projection: ArchitectureProjection, profile: LayoutProfile): Promise<LayoutResult> {
  const key = layoutCacheKey(projection, profile);
  const existing = cache.get(key); if (existing) return existing;
  const width = profile === "desktop" ? 250 : 210; const height = profile === "desktop" ? 112 : 96;
  const promise = elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered", "elk.direction": "RIGHT", "elk.edgeRouting": "ORTHOGONAL",
      "elk.spacing.nodeNode": profile === "desktop" ? "42" : "28", "elk.layered.spacing.nodeNodeBetweenLayers": profile === "desktop" ? "86" : "58",
      "elk.padding": "[top=32,left=32,bottom=32,right=32]",
    },
    children: projection.nodes.map((node) => ({ id: node.id, width, height })),
    edges: projection.edges.map((edge) => ({ id: edge.id, sources: [edge.source], targets: [edge.target] })),
  }).then((graph) => ({
    nodes: (graph.children ?? []).map((child) => ({ id: child.id, type: "architecture", position: { x: child.x ?? 0, y: child.y ?? 0 }, data: { node: projection.nodes.find((node) => node.id === child.id)! }, width, height })),
    edges: projection.edges.map((edge) => ({ id: edge.id, source: edge.source, target: edge.target, type: "architecture", label: edge.label, data: { kind: edge.kind } })),
    width: (graph as typeof graph & { width?: number }).width ?? 0,
    height: (graph as typeof graph & { height?: number }).height ?? 0,
  }));
  cache.set(key, promise); return promise;
}
