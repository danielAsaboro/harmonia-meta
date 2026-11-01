import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("architecture explorer documentation", () => {
  it("uses the canonical Mintlify architecture route as a native custom atlas", () => {
    const explorer = read("docs/architecture.mdx");
    const overview = read("docs/architecture/overview.mdx");
    const flowSourcePath = path.join(process.cwd(), "src/docs-architecture-flow.tsx");
    const pages = JSON.parse(read("docs/docs.json")).navigation.tabs[0].groups[0].pages;

    expect(explorer).toContain('mode: "custom"');
    expect(explorer).not.toContain("<iframe");
    expect(explorer).not.toContain("useharmonia.xyz/docs/architecture");
    expect(explorer).toContain('id="harmonia-react-flow"');
    expect(fs.existsSync(flowSourcePath)).toBe(true);
    const flowSource = fs.existsSync(flowSourcePath) ? fs.readFileSync(flowSourcePath, "utf8") : "";
    expect(flowSource).toContain('from "@xyflow/react"');
    expect(flowSource).toContain("ReactFlow");
    expect(flowSource).toContain("nodesDraggable={true}");
    expect(flowSource).toContain("nodesConnectable={false}");
    expect(flowSource).toContain("const nodeLinks");
    expect(flowSource).toContain('className="hf-read-more"');
    const nodeIds = [...flowSource.matchAll(/\bn\("([^"]+)"/g)].map((match) => match[1]);
    const linkedIds = [...flowSource.matchAll(/^  (\w+): \{ href: "([^"]+)"/gm)];
    expect(linkedIds.map((match) => match[1]).sort()).toEqual([...nodeIds].sort());
    for (const [, , href] of linkedIds) expect(fs.existsSync(path.join(process.cwd(), "docs", `${href.slice(1)}.mdx`))).toBe(true);
    for (const flow of ["System", "Workflow", "Agents", "State", "Effects", "APIs", "Recovery", "Telemetry"]) expect(flowSource).toContain(`label: "${flow}"`);
    expect(fs.existsSync(path.join(process.cwd(), "docs/architecture-flow.js"))).toBe(true);
    expect(overview).toContain("## System diagram");
    expect(pages).toEqual(expect.arrayContaining(["architecture", "architecture/overview"]));
  });

  it("is present in docs navigation", () => expect(JSON.parse(read("docs/docs.json")).navigation.tabs[0].groups[0].pages).toContain("architecture-explorer"));
  it("documents operation, semantics, maintenance, and accessibility", () => {
    const doc = read("docs/architecture-explorer.mdx").toLowerCase();
    for (const term of ["open the explorer", "edge semantics", "authority", "workflow", "state ownership", "human approval", "skill system", "tool system", "model allocation", "route families", "observability", "status vocabulary", "update the dataset", "validation", "keyboard", "narrow screens"]) expect(doc).toContain(term);
    for (const link of ["architecture/overview", "pipeline", "agent-platform", "state-ownership", "approval-and-audit", "tool-contracts", "observability", "models-cost-evaluation"]) expect(doc).toContain(`/${link}`);
  });
});
