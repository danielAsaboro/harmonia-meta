import { describe, expect, it } from "vitest";
import {
  decideStageOutboxClaim,
  finalizeStageOutbox,
  normalizeStageOutboxRecord,
  releaseStageOutboxClaim,
  type StageOutboxRecord,
} from "@/lib/stageOutbox";

const pending: StageOutboxRecord = {
  id: "outbox-1", workspaceId: "w1", brandId: "b1", jobId: "j1",
  stage: "understand", attempt: 0, state: "pending", createdAt: "2026-08-26T00:00:00Z",
  schemaVersion: 1, sourceEventId: "stage-outbox:outbox-1",
  operationId: "job:j1:stage:understand", correlationId: "job:j1", publishAttempt: 0,
};
const now = new Date("2026-08-26T00:01:00Z");

describe("stage outbox claim", () => {
  it("upgrades pre-runtime outbox records without changing their domain identity", () => {
    const legacy = {
      id: "outbox-legacy", workspaceId: "w1", brandId: "b1", jobId: "j1",
      stage: "draft", attempt: 0, state: "pending" as const, createdAt: "2026-08-26T00:00:00Z",
    };
    expect(normalizeStageOutboxRecord(legacy)).toMatchObject({
      schemaVersion: 1,
      sourceEventId: "stage-outbox:outbox-legacy",
      operationId: "job:j1:stage:draft",
      correlationId: "job:j1",
      publishAttempt: 0,
    });
  });

  it("allows one publisher and rejects live contention", () => {
    const owner = decideStageOutboxClaim(pending, "digest-a", now);
    expect(owner.outcome).toBe("publish");
    if (owner.outcome !== "publish") throw new Error("expected owner");
    expect(owner.record).toMatchObject({ publishAttempt: 1, sourceEventId: pending.sourceEventId });
    expect(decideStageOutboxClaim(owner.record, "digest-b", now).outcome).toBe("in_progress");
  });

  it("reclaims an expired publication lease because duplicate stage messages are safe", () => {
    const expired = {
      ...pending, state: "claimed" as const, claimTokenDigest: "old",
      claimUntil: "2026-08-26T00:00:59Z",
    };
    const reclaimed = decideStageOutboxClaim(expired, "new", now);
    expect(reclaimed.outcome).toBe("publish");
    if (reclaimed.outcome !== "publish") throw new Error("expected reclaim");
    expect(reclaimed.record).toMatchObject({ publishAttempt: 1, sourceEventId: pending.sourceEventId });
  });

  it("finalizes only for the owner and is idempotent for the same message", () => {
    const owner = decideStageOutboxClaim(pending, "digest-a", now);
    if (owner.outcome !== "publish") throw new Error("expected owner");
    expect(() => finalizeStageOutbox(owner.record, "wrong", "message-1", now)).toThrow("not owned");
    const published = finalizeStageOutbox(owner.record, "digest-a", "message-1", now);
    expect(finalizeStageOutbox(published, "digest-a", "message-1", now)).toEqual(published);
    expect(decideStageOutboxClaim(published, "digest-b", now).outcome).toBe("already_published");
  });

  it("releases a definite publish failure for safe retry", () => {
    const owner = decideStageOutboxClaim(pending, "digest-a", now);
    if (owner.outcome !== "publish") throw new Error("expected owner");
    expect(releaseStageOutboxClaim(owner.record, "digest-a")).toMatchObject({ state: "pending" });
  });
});
