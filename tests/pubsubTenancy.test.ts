import { describe, expect, it } from "vitest";
import { buildStageMessage } from "@/lib/pubsub";

describe("tenant-bound stage messages", () => {
  it("carries the durable workspace and brand with the job", () => {
    const built = buildStageMessage(
      { workspaceId: "workspace-a", brandId: "brand-a" },
      {
        id: "outbox-1", workspaceId: "workspace-a", brandId: "brand-a", jobId: "job-1",
        stage: "understand", attempt: 0, state: "claimed", createdAt: "2026-08-28T12:00:00.000Z",
        schemaVersion: 1, sourceEventId: "stage-outbox:outbox-1",
        operationId: "job:job-1:stage:understand", correlationId: "job:job-1", publishAttempt: 1,
      },
    );
    expect(JSON.parse(built.data.toString("utf8"))).toMatchObject({
      schemaVersion: 1,
      source: "stage_outbox",
      sourceEventId: "stage-outbox:outbox-1",
      workspaceId: "workspace-a",
      brandId: "brand-a",
      jobId: "job-1",
      eventType: "stage.requested",
      operationId: "job:job-1:stage:understand",
      attempt: 0,
      payload: { stage: "understand" },
    });
    expect(built.attributes.workspaceId).toBe("workspace-a");
    expect(built.attributes.sourceEventId).toBe("stage-outbox:outbox-1");
  });
});
