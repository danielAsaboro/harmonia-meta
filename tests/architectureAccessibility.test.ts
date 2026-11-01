import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("architecture explorer accessibility", () => {
  it("labels interactive controls and announces result changes", () => {
    const toolbar = read("src/components/architecture/ArchitectureToolbar.tsx");
    const explorer = read("src/components/architecture/ArchitectureExplorer.tsx");
    expect(toolbar).toContain('aria-label="Search architecture"');
    expect(toolbar).toContain("Expand all");
    expect(toolbar).toContain("Collapse all");
    expect(explorer).toContain('aria-live="polite"');
  });

  it("provides keyboard-operable mobile details", () => {
    const tree = read("src/components/architecture/ArchitectureMobileTree.tsx");
    const details = read("src/components/architecture/ArchitectureDetails.tsx");
    expect(tree).toContain("<button");
    expect(details).toContain('aria-label="Close architecture details"');
    expect(details).toContain("Escape");
  });
});
