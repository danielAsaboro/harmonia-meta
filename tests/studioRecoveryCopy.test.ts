import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("studio recovery controls", () => {
  it("uses a release-aware recovery control for a permanent protocol failure", () => {
    const states = readFileSync("src/components/studio/StudioStates.tsx", "utf8");
    const canvas = readFileSync("src/components/studio/WorkingCanvas.tsx", "utf8");
    expect(states).toContain("Harmonia needs a correction before this job can continue.");
    expect(states).toContain("Continue after correction");
    expect(canvas).toContain("onRetryAfterFix={!job.failure.retryable ? onRetry : undefined}");
  });
});
