import { describe, expect, it } from "vitest";
import { latestSurfaceOperations } from "../src/lib/a2ui/surfaceSlots";

const catalogId = "https://harmonia.app/a2ui/catalogs/chat/v1";

function revision(runId: string, slot: "canvas" | "conversation" | "approval", number: number, child: string) {
  const surfaceId = `studio-${runId}-${slot}-r${number}`;
  return [
    { version: "v0.9", createSurface: { surfaceId, catalogId } },
    { version: "v0.9", updateComponents: { surfaceId, components: [
      { id: "root", component: "Column", children: [child] },
      { id: child, component: "SurfaceEmpty", title: `Revision ${number}`, message: "No content", children: [], emphasis: "primary", agentFraming: false },
    ] } },
  ];
}

describe("A2UI studio surface slots", () => {
  it("returns the latest complete canvas revision without flattening children", () => {
    const selected = latestSurfaceOperations([
      ...revision("run-1", "canvas", 1, "old"),
      ...revision("run-1", "approval", 8, "approval"),
      ...revision("run-1", "canvas", 2, "drafts"),
    ], "canvas");

    expect(JSON.stringify(selected)).toContain("studio-run-1-canvas-r2");
    expect(JSON.stringify(selected)).toContain('"children":["drafts"]');
    expect(JSON.stringify(selected)).not.toContain("studio-run-1-canvas-r1");
    expect(JSON.stringify(selected)).not.toContain("approval");
  });

  it("ignores an incomplete newer revision", () => {
    const selected = latestSurfaceOperations([
      ...revision("run-1", "conversation", 1, "complete"),
      { version: "v0.9", createSurface: { surfaceId: "studio-run-1-conversation-r2", catalogId } },
    ], "conversation");

    expect(JSON.stringify(selected)).toContain("conversation-r1");
    expect(JSON.stringify(selected)).not.toContain("conversation-r2");
  });

  it("rejects duplicate surface creation", () => {
    const create = { version: "v0.9", createSurface: { surfaceId: "studio-run-1-canvas-r1", catalogId } };
    expect(() => latestSurfaceOperations([create, create], "canvas")).toThrow("duplicate createSurface");
  });

  it("rejects updates before their surface is created", () => {
    expect(() => latestSurfaceOperations([{
      version: "v0.9",
      updateComponents: { surfaceId: "studio-run-1-canvas-r1", components: [{ id: "root", component: "Column", children: [] }] },
    }], "canvas")).toThrow("before createSurface");
  });
});
