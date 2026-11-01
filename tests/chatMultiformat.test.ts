import { describe, expect, it } from "vitest";

import { parseLocalIntent } from "@/lib/chatIntent";

describe("multiformat chat intent", () => {
  it("requests persisted content artifacts instead of legacy X-only drafts", () => {
    expect(parseLocalIntent("show artifacts for job job-123")).toEqual({
      intent: "list_artifacts", jobId: "job-123",
    });
  });

  it("does not require registry output tags in ordinary requests", () => {
    const parsed = parseLocalIntent("Turn https://example.com/launch into the best launch content for founders");
    expect(parsed.intent).toBe("create_job");
    expect(parsed.desiredOutputs).toBeUndefined();
  });
});
