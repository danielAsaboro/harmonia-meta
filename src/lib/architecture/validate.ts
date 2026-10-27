import { ArchitectureDefinitionSchema, type ArchitectureDefinition } from "./schema";

const forbiddenAgentAuthorities = new Set(["approve", "execute-effect", "write"]);

function unique(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) throw new Error(`Duplicate ${label} id: ${value}`);
    seen.add(value);
  }
}

export function validateArchitecture(input: unknown): ArchitectureDefinition {
  const definition = ArchitectureDefinitionSchema.parse(input);
  unique(definition.nodes.map((node) => node.id), "node");
  unique(definition.edges.map((edge) => edge.id), "edge");
  unique(definition.presets.map((preset) => preset.id), "preset");
  const nodes = new Map(definition.nodes.map((node) => [node.id, node]));
  for (const edge of definition.edges) if (!nodes.has(edge.source) || !nodes.has(edge.target)) throw new Error(`Dangling edge: ${edge.id}`);
  for (const node of definition.nodes) {
    if (node.parentId && !nodes.has(node.parentId)) throw new Error(`Unknown parent: ${node.parentId}`);
    for (const path of node.sourceFiles ?? []) if (path.startsWith("/") || path.includes("resources/")) throw new Error(`Private path is not allowed: ${path}`);
    if (node.kind === "agent" && node.authorities.some((authority) => forbiddenAgentAuthorities.has(authority))) throw new Error(`Agent authority is prohibited: ${node.id}`);
  }
  for (const node of definition.nodes) {
    const visited = new Set<string>(); let cursor = node;
    while (cursor.parentId) {
      if (visited.has(cursor.id)) throw new Error(`Group ownership cycle at ${node.id}`);
      visited.add(cursor.id); cursor = nodes.get(cursor.parentId)!;
    }
  }
  const firestore = nodes.get("firestore");
  if (!firestore || firestore.stateLifetime !== "durable") throw new Error("Firestore must be the durable source of truth");
  const engine = nodes.get("agent-engine");
  if (!engine || engine.stateLifetime !== "ephemeral") throw new Error("Agent Engine must be ephemeral");
  for (const effect of definition.nodes.filter((node) => node.kind === "effect")) {
    if (effect.approval === "Required" && !definition.edges.some((edge) => edge.target === effect.id && edge.kind === "approval")) {
      throw new Error(`Approval-gated effect requires approval: ${effect.id}`);
    }
    if (!definition.edges.some((edge) => edge.source === effect.id && edge.kind === "verification")) throw new Error(`Effect requires independent verification: ${effect.id}`);
  }
  return definition;
}
