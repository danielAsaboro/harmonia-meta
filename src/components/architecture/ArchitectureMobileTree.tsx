import type { ArchitectureDefinition, ArchitectureNode } from "@/lib/architecture/schema";

export function ArchitectureMobileTree({ definition, visibleNodes, expanded, onToggle, onSelect }: { definition: ArchitectureDefinition; visibleNodes: ArchitectureNode[]; expanded: string[]; onToggle: (id: string) => void; onSelect: (id: string) => void }) {
  const visible = new Set(visibleNodes.map((node) => node.id));
  const children = (parentId?: string) => definition.nodes.filter((node) => node.parentId === parentId && visible.has(node.id));
  const branch = (node: ArchitectureNode) => <li key={node.id}><div><button type="button" onClick={() => onSelect(node.id)}><b>{node.name}</b><span>{node.summary}</span></button>{node.kind === "group" ? <button type="button" aria-label={`${expanded.includes(node.id) ? "Collapse" : "Expand"} ${node.name}`} onClick={() => onToggle(node.id)}>{expanded.includes(node.id) ? "−" : "+"}</button> : null}</div>{expanded.includes(node.id) ? <ul>{children(node.id).map(branch)}</ul> : null}</li>;
  return <nav className="arch-mobile-tree" aria-label="Architecture hierarchy"><ul>{children(undefined).map(branch)}</ul></nav>;
}
