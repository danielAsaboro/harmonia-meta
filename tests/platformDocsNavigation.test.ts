import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type NavGroup = { group: string; root?: string; pages: string[] };
type NavTab = { tab: string; groups?: NavGroup[] };

const root = process.cwd();
const config = JSON.parse(readFileSync(join(root, "docs/docs.json"), "utf8")) as {
  navigation: { tabs: NavTab[] };
};

describe("platform documentation navigation", () => {
  it("exposes a grouped Platform tab whose pages resolve", () => {
    const tab = config.navigation.tabs.find((item) => item.tab === "Platform");

    expect(tab?.groups?.map((group) => group.group)).toEqual([
      "Overview",
      "UI",
      "Agents and AI",
      "Security and identity",
      "Storage and messaging",
      "Runtime and automation",
      "Media",
      "Integrations",
      "Logging and monitoring",
    ]);

    const pages = tab?.groups?.flatMap((group) => [group.root, ...group.pages].filter(Boolean) as string[]) ?? [];
    expect(pages.length).toBeGreaterThan(25);
    for (const page of pages) {
      const path = join(root, "docs", `${page}.mdx`);
      expect(existsSync(path), `missing ${path}`).toBe(true);
      const contents = readFileSync(path, "utf8");
      expect(contents.startsWith("---\n")).toBe(true);
      expect(contents).toContain("## How Harmonia uses it");
      expect(contents).toContain("## Evidence status");
    }
  });
});
