import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), "utf8");

describe("architecture route integration", () => {
  it("exposes the explorer as a public full-page documentation route", () => {
    expect(read("src/app/docs/architecture/page.tsx")).toContain("ArchitectureExplorer");
    expect(read("src/app/docs/architecture/page.tsx")).toContain("architecture.css");
    expect(read("src/app/dashboard/architecture/page.tsx")).toContain('redirect("/docs/architecture")');
    const nav = read("src/components/NavRail.tsx");
    expect(nav).not.toContain('href: "/docs/architecture"');
    expect(nav).not.toContain("ArchitectureIcon");
  });

  it("uses Harmonia's paper, forest, and acid system without the PNG as graph background", () => {
    const css = read("src/app/docs/architecture/architecture.css");
    expect(css).toContain("--arch-paper");
    expect(css).toContain("--arch-forest");
    expect(css).toContain("--arch-acid");
    expect(css).toContain("background:var(--arch-paper)");
    expect(css).toContain("@media (max-width: 639px)");
    expect(css).not.toContain("harmonia-complete-architecture-blueprint.png");
  });

  it("keeps preset overviews readable instead of fitting the entire graph too small", () => {
    expect(read("src/components/architecture/ArchitectureExplorer.tsx")).toContain("minZoom: 0.38");
  });

  it("allows every graph node to be repositioned without snapping back", () => {
    const explorer = read("src/components/architecture/ArchitectureExplorer.tsx");
    expect(explorer).toContain("useNodesState");
    expect(explorer).toContain("nodesDraggable");
    expect(explorer).toContain("onNodesChange={onNodesChange}");
    expect(explorer).not.toContain("nodesDraggable={false}");
  });

  it("uses compact edge markers until a connector is selected", () => {
    const explorer = read("src/components/architecture/ArchitectureExplorer.tsx");
    const edge = read("src/components/architecture/ArchitectureEdge.tsx");
    expect(explorer).toContain("useEdgesState");
    expect(explorer).toContain("onEdgesChange={onEdgesChange}");
    expect(edge).toContain("props.selected");
    expect(edge).toContain("interactionWidth={24}");
    expect(edge).toContain("props.data?.label");
  });
});
