import { describe, expect, it } from "vitest";
import { validateArchitecture } from "../src/lib/architecture/validate";

const valid = {
  version: "test",
  nodes: [
    { id: "firestore", name: "Firestore", kind: "store", layer: "data", statuses: ["implemented"], authorities: ["read", "write"], dataScope: "workspace", stateLifetime: "durable", summary: "Durable source of truth" },
    { id: "agent-engine", name: "Agent Engine", kind: "runtime", layer: "agents", statuses: ["pending-live"], authorities: ["delegate"], dataScope: "workspace", stateLifetime: "ephemeral", summary: "Cognitive runtime" },
    { id: "approval", name: "Approval", kind: "gate", layer: "effects", statuses: ["approval-gated"], authorities: ["approve"], dataScope: "workspace", stateLifetime: "durable", summary: "Human gate" },
    { id: "effect", name: "Effect", kind: "effect", layer: "effects", statuses: ["approval-gated"], authorities: ["execute-effect"], dataScope: "external", stateLifetime: "external", summary: "Official provider effect", approval: "Required" },
    { id: "verification", name: "Verification", kind: "verification", layer: "effects", statuses: ["implemented"], authorities: ["read"], dataScope: "external", stateLifetime: "durable", summary: "Independent read-back" },
  ],
  edges: [
    { id: "approve", source: "approval", target: "effect", kind: "approval", label: "Human approval" },
    { id: "verify", source: "effect", target: "verification", kind: "verification", label: "Independent read-back" },
  ],
  presets: [{ id: "overview", name: "Overview", expanded: [], layers: [], statuses: [], focusNodeIds: ["firestore"] }],
};

describe("architecture validation", () => {
  it("accepts a safe architecture", () => expect(validateArchitecture(valid)).toBeTruthy());

  it("rejects duplicate nodes and dangling edges", () => {
    expect(() => validateArchitecture({ ...valid, nodes: [...valid.nodes, valid.nodes[0]] })).toThrow(/duplicate node/i);
    expect(() => validateArchitecture({ ...valid, edges: [...valid.edges, { id: "bad", source: "missing", target: "effect", kind: "workflow", label: "bad" }] })).toThrow(/dangling/i);
  });

  it("rejects group cycles and private paths", () => {
    const groups = [
      { ...valid.nodes[0], id: "a", kind: "group", parentId: "b", sourceFiles: ["src/a.ts"] },
      { ...valid.nodes[0], id: "b", kind: "group", parentId: "a" },
    ];
    expect(() => validateArchitecture({ ...valid, nodes: [...valid.nodes, ...groups] })).toThrow(/cycle/i);
    expect(() => validateArchitecture({ ...valid, nodes: [{ ...valid.nodes[0], sourceFiles: ["/Users/private/file.ts"] }, ...valid.nodes.slice(1)] })).toThrow(/private path/i);
  });

  it("enforces agent authority and runtime ownership", () => {
    const agent = { ...valid.nodes[1], id: "agent", kind: "agent", authorities: ["approve"] };
    expect(() => validateArchitecture({ ...valid, nodes: [...valid.nodes, agent] })).toThrow(/agent.*authority/i);
    expect(() => validateArchitecture({ ...valid, nodes: valid.nodes.map((n) => n.id === "agent-engine" ? { ...n, stateLifetime: "durable" } : n) })).toThrow(/Agent Engine.*ephemeral/i);
  });

  it("enforces approval and independent verification for effects", () => {
    expect(() => validateArchitecture({ ...valid, edges: valid.edges.filter((e) => e.kind !== "approval") })).toThrow(/approval/i);
    expect(() => validateArchitecture({ ...valid, edges: valid.edges.filter((e) => e.kind !== "verification") })).toThrow(/verification/i);
  });
});
