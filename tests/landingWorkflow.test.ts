import { describe, expect, it } from "vitest";

import {
  getApprovalOutcome,
  getLiveWorkflowFrame,
  getWorkflowStage,
  LIVE_WORKFLOW_FRAMES,
  WORKFLOW_STAGES,
} from "../src/components/landing/workflow";

describe("landing workflow", () => {
  it("wraps the content loop in both directions", () => {
    expect(getWorkflowStage(WORKFLOW_STAGES.length).id).toBe("source");
    expect(getWorkflowStage(-1).id).toBe("learn");
  });

  it("keeps approval between drafted content and publishing", () => {
    const ids = WORKFLOW_STAGES.map((stage) => stage.id);

    expect(ids.slice(ids.indexOf("draft"), ids.indexOf("publish") + 1)).toEqual([
      "draft",
      "approve",
      "publish",
    ]);
  });

  it("turns approval decisions into honest next-step copy", () => {
    expect(getApprovalOutcome("approved")).toEqual({
      label: "Approved",
      detail: "Publish action unlocked",
    });
    expect(getApprovalOutcome("revision")).toEqual({
      label: "Revision requested",
      detail: "Publishing remains locked",
    });
  });

  it("keeps the live workflow approval gate ahead of every external action", () => {
    const frameIds = LIVE_WORKFLOW_FRAMES.map((frame) => frame.id);

    expect(frameIds.slice(frameIds.indexOf("approval"), frameIds.indexOf("verified") + 1)).toEqual([
      "approval",
      "publish",
      "verified",
    ]);
    expect(LIVE_WORKFLOW_FRAMES.find((frame) => frame.id === "approval")?.requiresClick).toBe(true);
  });

  it("loops the live workflow playback without losing the source frame", () => {
    expect(getLiveWorkflowFrame(0).id).toBe("source");
    expect(getLiveWorkflowFrame(LIVE_WORKFLOW_FRAMES.length).id).toBe("source");
    expect(getLiveWorkflowFrame(-1).id).toBe("verified");
  });
});
