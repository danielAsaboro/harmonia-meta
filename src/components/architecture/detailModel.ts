import type { ArchitectureNode } from "@/lib/architecture/schema";

export function getResponsiveMode(width: number): "tree" | "graph" { return width < 640 ? "tree" : "graph"; }

export function buildArchitectureDetail(node: ArchitectureNode) {
  const authorityNote = node.id === "agent-temi" ? "Temi proposes a complete editorial-plan proposal with no external calendar authority; it cannot approve, schedule externally, or publish. Deterministic code owns validation, persistence, selection, scheduling, approval, and effects." : node.summary;
  return { ...node, model: node.model?.name, authorityNote, deepLink: `?node=${node.id}` };
}
