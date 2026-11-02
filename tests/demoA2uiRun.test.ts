import { describe, expect, it } from "vitest";
import { parseHarmoniaA2uiOperation } from "../src/components/a2ui/HarmoniaCatalog";
import { parseChatStreamEvent } from "../src/lib/a2ui/contracts";
import { buildDemoChatRunEvents } from "../scripts/demo-a2ui-events.mjs";

describe("buildDemoChatRunEvents", () => {
  it("produces a complete validated A2UI replay with every demo surface", () => {
    const events = buildDemoChatRunEvents({
      runId: "demo-a2ui-multimodal",
      startedAt: "2026-08-23T08:55:20.000Z",
      completedAt: "2026-08-23T08:55:25.000Z",
      jobId: "demo-clips",
      confirmationJobId: "demo-launch",
      confirmationActionId: "act-pub-launch",
      imageSizeBytes: 1024,
      clipSizeBytes: 2048,
      reelSizeBytes: 4096,
    }).map(parseChatStreamEvent);

    expect(events.map((event) => event.sequence)).toEqual(events.map((_, index) => index));
    expect(events.at(-1)?.type).toBe("run_completed");

    const operations = events
      .filter((event) => event.type === "a2ui_operation")
      .map((event) => parseHarmoniaA2uiOperation(event.operation));
    const componentNames = operations.flatMap((operation) => "updateComponents" in operation
      ? operation.updateComponents.components.map((component) => component.component)
      : []);
    expect(componentNames).toEqual(expect.arrayContaining([
      "CampaignBrief",
      "MomentExplorer",
      "DraftComparison",
      "PlatformPreview",
      "SourceEvidence",
      "JobProgress",
      "SurfaceUnresolved",
    ]));
    const serialized = JSON.stringify(events);
    expect(serialized).toContain("local renderer A2UI fixture");
    expect(serialized).toContain("No trusted hydration");
    expect(serialized).not.toContain("ApprovalReview");
    expect(serialized).not.toContain("Audio generated");
    expect(serialized).not.toContain("model invocation complete");
  });
});
