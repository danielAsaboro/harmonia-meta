import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const agentIds = ["nimi", "ryan", "temi", "noni", "dara", "maya", "nova"] as const;

describe("agent documentation reference", () => {
  it("publishes one navigated skills, tools, prompts, and traces inventory", () => {
    const navigation = readFileSync("docs/docs.json", "utf8");
    const inventory = readFileSync("docs/reference/agent-runtime-inventory.mdx", "utf8");
    expect(navigation).toContain('"reference/agent-runtime-inventory"');
    for (const value of [
      "nimi_analyst", "ryan_strategist", "temi_editorial_planner",
      "noni_copywriter", "dara_editor", "maya_presenter", "nova_liaison",
      "nimi-analysis-skills", "ryan-strategy-skills", "temi-editorial-planning-skills",
      "noni-writing-skills", "dara-editing-skills",
      "Skill guidance is method, never evidence",
      "Search is a tool, not a skill",
      "Memory Bank is advisory context, never authority",
    ]) expect(inventory).toContain(value);
  });

  it("standardizes every agent page around the same lookup questions", () => {
    for (const id of agentIds) {
      const page = readFileSync(`docs/agents/${id}.mdx`, "utf8");
      for (const heading of [
        "## Role", "## Contract", "## Skills", "## Tools and research",
        "## Prompt method", "## Evidence and provenance", "## Authority boundary",
        "## Handoff", "## Runtime enforcement", "## Implementation references",
      ]) expect(page, `${id} missing ${heading}`).toContain(heading);
    }
  });

  it("keeps current runtime labels free of superseded role names and Temi tool-free claims", () => {
    const current = [
      "README.md", "docs/agents/overview.mdx", "docs/agent-platform.mdx",
      "docs/pipeline.mdx", "docs/reference/agent-contracts.mdx",
      "docs/reference/agent-runtime-inventory.mdx",
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    expect(current).not.toMatch(/Sophia|Nimi copywriter|Temi[^\n]{0,120}(?:tool-free|has no tools)/i);
  });
});
