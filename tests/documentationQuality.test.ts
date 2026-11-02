import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

type NavGroup = { root?: string; pages: string[] };
type NavTab = { pages?: string[]; groups?: NavGroup[] };
const root = process.cwd();
const docsRoot = join(root, "docs");
const config = JSON.parse(readFileSync(join(docsRoot, "docs.json"), "utf8")) as {
  navigation: { tabs: NavTab[] };
};
const navigated = config.navigation.tabs.flatMap((tab) =>
  tab.pages ?? tab.groups?.flatMap((group) => [group.root, ...group.pages].filter(Boolean) as string[]) ?? [],
);

function publicMdx(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "superpowers" ? [] : publicMdx(path);
    return entry.name.endsWith(".mdx")
      ? [relative(docsRoot, path).replace(/\.mdx$/, "")]
      : [];
  });
}

describe("public documentation quality", () => {
  it("navigates every public MDX page exactly once", () => {
    expect([...new Set(navigated)].sort()).toEqual(publicMdx(docsRoot).sort());
  });

  it("requires unique titles and complete frontmatter", () => {
    const titles = new Set<string>();
    for (const slug of navigated) {
      const contents = readFileSync(join(docsRoot, `${slug}.mdx`), "utf8");
      const title = contents.match(/^title:\s*"?([^"\n]+)"?$/m)?.[1].trim();
      const description = contents.match(/^description:\s*"?([^"\n]+)"?$/m)?.[1].trim();
      expect(title, `${slug} missing title`).toBeTruthy();
      expect(description, `${slug} missing description`).toBeTruthy();
      expect(titles.has(title!), `duplicate title ${title}`).toBe(false);
      titles.add(title!);
    }
  });

  it("resolves documentation links and concrete source references", () => {
    const slugs = new Set(navigated);
    for (const slug of navigated) {
      const contents = readFileSync(join(docsRoot, `${slug}.mdx`), "utf8");
      for (const match of contents.matchAll(/\]\(\/([^#?)\s]+)(?:[#?][^)]*)?\)/g)) {
        const target = match[1];
        if (target.startsWith("api/") || target.startsWith("dashboard") || target === "docs/architecture") continue;
        expect(slugs.has(target), `${slug} links to missing /${target}`).toBe(true);
      }
      for (const match of contents.matchAll(/`((?:agent|src|infra|docs)\/[^`]+)`/g)) {
        const target = match[1];
        if (target.endsWith("/") || target.includes("[") || target.includes("*")) continue;
        expect(existsSync(join(root, target)), `${slug} cites missing ${target}`).toBe(true);
      }
    }
  });
});
