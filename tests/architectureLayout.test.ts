import { describe, expect, it } from "vitest";
import { architectureDefinition } from "../src/lib/architecture/data";
import { createDefaultExplorerState } from "../src/lib/architecture/explorerState";
import { layoutArchitecture, layoutCacheKey } from "../src/lib/architecture/layout";
import { projectArchitecture } from "../src/lib/architecture/project";

describe("architecture ELK layout", () => {
  it("builds stable structural cache keys", () => {
    const projection = projectArchitecture(architectureDefinition, createDefaultExplorerState(architectureDefinition));
    expect(layoutCacheKey(projection, "desktop")).toBe(layoutCacheKey(projection, "desktop"));
    expect(layoutCacheKey(projection, "desktop")).not.toBe(layoutCacheKey(projection, "compact"));
  });

  it("returns positioned nodes with orthogonal edge points", async () => {
    const projection = projectArchitecture(architectureDefinition, createDefaultExplorerState(architectureDefinition));
    const result = await layoutArchitecture(projection, "desktop");
    expect(result.nodes.every((node) => Number.isFinite(node.position.x) && Number.isFinite(node.position.y))).toBe(true);
    expect(result.edges.length).toBe(projection.edges.length);
  });
});
