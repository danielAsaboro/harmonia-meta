import { describe, expect, it } from "vitest";
import { architectureDefinition } from "../src/lib/architecture/data";
import { activateNode, applyPreset, createDefaultExplorerState, parseExplorerQuery, serializeExplorerQuery, toggleGroup } from "../src/lib/architecture/explorerState";

describe("architecture explorer state", () => {
  it("restores and normalizes valid URL state", () => {
    const state = parseExplorerQuery(new URLSearchParams("preset=agents&node=agent-nova&expanded=group-skills,bad&layers=agents,bad&q=Nova"), architectureDefinition);
    expect(state.presetId).toBe("agents");
    expect(state.selectedNodeId).toBe("agent-nova");
    expect(state.expanded).toContain("group-skills");
    expect(state.expanded).not.toContain("bad");
    expect(state.layers).toEqual(["agents"]);
    expect(serializeExplorerQuery(state).toString()).toContain("node=agent-nova");
  });

  it("applies presets and toggles groups without mutating prior state", () => {
    const initial = createDefaultExplorerState(architectureDefinition);
    const agents = applyPreset(initial, "agents", architectureDefinition);
    expect(agents.expanded).toContain("workflow-writing-review");
    const collapsed = toggleGroup(agents, "workflow-writing-review");
    expect(collapsed.expanded).not.toContain("workflow-writing-review");
    expect(agents.expanded).toContain("workflow-writing-review");
  });

  it("activates group nodes by selecting and expanding or collapsing them", () => {
    const initial = { ...createDefaultExplorerState(architectureDefinition), expanded: [] };
    const expanded = activateNode(initial, "group-agent-team", architectureDefinition);
    expect(expanded.selectedNodeId).toBe("group-agent-team");
    expect(expanded.expanded).toContain("group-agent-team");
    expect(activateNode(expanded, "group-agent-team", architectureDefinition).expanded).not.toContain("group-agent-team");
  });

  it("round-trips an explicit collapse-all URL", () => {
    const collapsed = { ...createDefaultExplorerState(architectureDefinition), expanded: [] };
    const params = serializeExplorerQuery(collapsed);
    expect(params.has("expanded")).toBe(true);
    expect(parseExplorerQuery(params, architectureDefinition).expanded).toEqual([]);
  });
});
