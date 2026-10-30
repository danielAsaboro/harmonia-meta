"use client";

import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { ArchitectureNode as DomainNode, ArchitectureStatus } from "@/lib/architecture/schema";

export const statusTone: Record<ArchitectureStatus, { label: string; className: string }> = {
  implemented: { label: "Implemented", className: "arch-status--implemented" },
  "offline-verified": { label: "Offline verified", className: "arch-status--verified" },
  "approval-gated": { label: "Approval gated", className: "arch-status--approval" },
  "read-only": { label: "Read only", className: "arch-status--read" },
  "pending-live": { label: "Pending live evidence", className: "arch-status--pending" },
  planned: { label: "Planned", className: "arch-status--planned" },
  unsupported: { label: "Unsupported", className: "arch-status--unsupported" },
};

export function ArchitectureNode({ data, selected }: NodeProps) {
  const node = data.node as DomainNode;
  return <article className={`arch-node arch-node--${node.layer}${selected ? " is-selected" : ""}`} aria-label={`${node.name}. ${node.summary}`} tabIndex={0}>
    <Handle type="target" position={Position.Left} />
    <div className="arch-node__eyebrow"><span>{node.kind}</span><span>{node.stateLifetime}</span></div>
    <h3>{node.name}</h3>
    {node.model ? <p className="arch-node__model">{node.model.name}</p> : null}
    <p>{node.summary}</p>
    <div className="arch-node__statuses">{node.statuses.slice(0, 2).map((status) => <span key={status} className={statusTone[status].className}>{statusTone[status].label}</span>)}</div>
    <Handle type="source" position={Position.Right} />
  </article>;
}
