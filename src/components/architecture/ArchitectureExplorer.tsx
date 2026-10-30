"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Controls, MarkerType, MiniMap, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, type Edge, type Node, type ReactFlowInstance } from "@xyflow/react";
import { useRouter } from "next/navigation";
import { architectureDefinition } from "@/lib/architecture/data";
import { activateNode, applyPreset, createDefaultExplorerState, parseExplorerQuery, serializeExplorerQuery, toggleGroup, type ExplorerState } from "@/lib/architecture/explorerState";
import { layoutArchitecture, layoutCacheKey, type LayoutResult } from "@/lib/architecture/layout";
import { projectArchitecture } from "@/lib/architecture/project";
import { ArchitectureDetails } from "./ArchitectureDetails";
import { ArchitectureEdge, edgeAppearance } from "./ArchitectureEdge";
import { ArchitectureLegend } from "./ArchitectureLegend";
import { ArchitectureMobileTree } from "./ArchitectureMobileTree";
import { ArchitectureNode } from "./ArchitectureNode";
import { ArchitectureToolbar } from "./ArchitectureToolbar";

const nodeTypes = { architecture: ArchitectureNode }; const edgeTypes = { architecture: ArchitectureEdge };

function ExplorerInner() {
  const router = useRouter();
  const [state, setState] = useState<ExplorerState>(() => typeof window === "undefined" ? createDefaultExplorerState(architectureDefinition) : parseExplorerQuery(new URLSearchParams(window.location.search), architectureDefinition));
  const projection = useMemo(() => projectArchitecture(architectureDefinition, state), [state]);
  const projectionKey = layoutCacheKey(projection, "desktop");
  const [layoutState, setLayoutState] = useState<{ key: string; result: LayoutResult }>({ key: "", result: { nodes: [], edges: [], width: 0, height: 0 } });
  const layingOut = layoutState.key !== projectionKey;
  const [flowNodes, setFlowNodes, onNodesChange] = useNodesState<Node>([]);
  const [flowEdges, setFlowEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const instance = useRef<ReactFlowInstance | null>(null); const shouldFit = useRef(true);
  const update = useCallback((next: ExplorerState) => { setState(next); router.replace(`?${serializeExplorerQuery(next)}`, { scroll: false }); }, [router]);
  useEffect(() => { let active = true; layoutArchitecture(projection, "desktop").then((result) => { if (!active) return; setLayoutState({ key: projectionKey, result }); setFlowNodes(result.nodes); setFlowEdges(result.edges.map((edge) => { const kind = (edge.data?.kind ?? "workflow") as keyof typeof edgeAppearance; return { ...edge, markerEnd: { type: MarkerType.ArrowClosed, color: edgeAppearance[kind].color } }; })); if (shouldFit.current) requestAnimationFrame(() => instance.current?.fitView({ padding: 0.16, duration: 500, minZoom: 0.38 })); shouldFit.current = false; }); return () => { active = false; }; }, [projection, projectionKey, setFlowEdges, setFlowNodes]);
  const selected = architectureDefinition.nodes.find((node) => node.id === state.selectedNodeId);
  const select = (id?: string) => update(id ? activateNode(state, id, architectureDefinition) : { ...state, selectedNodeId: undefined });
  const preset = (id: string) => { shouldFit.current = true; update(applyPreset(state, id, architectureDefinition)); };
  const expandAll = () => update({ ...state, expanded: architectureDefinition.nodes.filter((node) => node.kind === "group").map((node) => node.id) });
  return <div className="architecture-shell">
    <ArchitectureToolbar definition={architectureDefinition} state={state} onChange={update} onPreset={preset} onExpandAll={expandAll} onCollapseAll={() => update({ ...state, expanded: [] })} onFit={() => instance.current?.fitView({ padding: 0.16, duration: 400, minZoom: 0.38 })} />
    <div className="arch-live" aria-live="polite">{projection.nodes.length} components visible{layingOut ? " · updating layout" : ""}</div>
    <main className="arch-stage">
      <div className="arch-graph"><ReactFlow<Node, Edge> nodes={flowNodes} edges={flowEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} onInit={(flow) => { instance.current = flow; }} onNodeClick={(_, graphNode) => select(graphNode.id)} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} nodesDraggable fitView fitViewOptions={{ padding: 0.16, minZoom: 0.38 }} minZoom={0.3} maxZoom={1.8}><Background color="#d4d2c7" gap={24} size={1} /><Controls /><MiniMap pannable zoomable nodeColor="#6e7c70" maskColor="rgba(241,240,231,.66)" /></ReactFlow>{layingOut ? <div className="arch-layout-state">Recalculating architecture…</div> : null}</div>
      <ArchitectureMobileTree definition={architectureDefinition} visibleNodes={projection.nodes} expanded={state.expanded} onToggle={(id) => update(toggleGroup(state, id))} onSelect={select} />
      <ArchitectureLegend />
      <ArchitectureDetails node={selected} onClose={() => select(undefined)} />
    </main>
  </div>;
}

export function ArchitectureExplorer() { return <ReactFlowProvider><ExplorerInner /></ReactFlowProvider>; }
