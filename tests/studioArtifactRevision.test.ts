import { describe, expect, it } from "vitest";
import { artifactRevisionRequest, platformPreviewLabel } from "@/components/studio/WrittenWorkspace";

describe("studio artifact revision", () => {
  it("creates a grounded chat request from the edited preview", () => {
    expect(artifactRevisionRequest("job-1", "draft-1", "Make the opening more direct.")).toBe(
      "Revise artifact draft-1 for job job-1. Use this operator-edited draft as direction, preserve source grounding, and create a new reviewed revision without changing the accepted artifact in place:\n\nMake the opening more direct.",
    );
  });

  it.each([
    ["x_post", "X post preview"],
    ["linkedin_post", "LinkedIn post preview"],
    ["newsletter", "Newsletter preview"],
  ])("maps %s to a native preview label", (outputType, expected) => {
    expect(platformPreviewLabel(outputType)).toBe(expected);
  });
});
