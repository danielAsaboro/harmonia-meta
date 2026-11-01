import { describe, expect, it } from "vitest";
import { architectureDefinition } from "../src/lib/architecture/data";
import { createDefaultExplorerState } from "../src/lib/architecture/explorerState";
import { projectArchitecture, searchArchitecture } from "../src/lib/architecture/project";

describe("architecture projection", () => {
  it("uses summary groups until expanded", () => {
    const state = { ...createDefaultExplorerState(architectureDefinition), expanded: [] };
    expect(projectArchitecture(architectureDefinition, state).nodes.some((node) => node.id === "group-agent-team")).toBe(true);
    expect(projectArchitecture(architectureDefinition, state).nodes.some((node) => node.id === "agent-nova")).toBe(false);
    expect(projectArchitecture(architectureDefinition, { ...state, expanded: ["group-agent-team"] }).nodes.some((node) => node.id === "agent-nova")).toBe(true);
  });

  it("searches names, models, routes, tools, and skills and reveals ancestors", () => {
    expect(searchArchitecture(architectureDefinition, "noni-writing-skills")).toContain("agent-noni");
    expect(searchArchitecture(architectureDefinition, "/api/chat/stream")).toContain("api-chat");
    const projection = projectArchitecture(architectureDefinition, { ...createDefaultExplorerState(architectureDefinition), expanded: [], query: "suggest_posting_windows" });
    expect(projection.nodes.some((node) => node.id === "tool-suggest-posting-windows")).toBe(true);
    expect(projection.nodes.some((node) => node.id === "group-tools")).toBe(true);
  });

  it("filters by layer and lifts hidden edge endpoints", () => {
    const state = { ...createDefaultExplorerState(architectureDefinition), expanded: [], layers: ["agents" as const] };
    const projection = projectArchitecture(architectureDefinition, state);
    expect(projection.nodes.every((node) => node.layer === "agents")).toBe(true);
    expect(new Set(projection.edges.map((edge) => edge.id)).size).toBe(projection.edges.length);
  });
});
