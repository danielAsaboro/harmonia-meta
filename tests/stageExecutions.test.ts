import { describe, expect, it } from "vitest";
import { claimStageExecution, finalizeStageExecution, type StageExecution } from "@/lib/stageExecutions";

const execution: StageExecution = {
  jobId: "job-1",
  stage: "draft",
  operationId: "job:job-1:stage:draft:generation:0",
  state: "claimed",
  ownerId: "worker-a",
  claimTokenDigest: "a".repeat(64),
  claimedAt: "2026-08-26T00:00:00.000Z",
  leaseExpiresAt: "2026-08-26T00:05:00.000Z",
  updatedAt: "2026-08-26T00:00:00.000Z",
};

describe("stage execution leases", () => {
  it("allows only the current lease owner to execute", () => {
    expect(claimStageExecution(execution, {
      ownerId: "worker-b", claimTokenDigest: "b".repeat(64),
      now: "2026-08-26T00:01:00.000Z", leaseExpiresAt: "2026-08-26T00:06:00.000Z",
    }).outcome).toBe("in_progress");
  });

  it("quarantines an expired claim instead of replaying an ambiguous stage", () => {
    expect(claimStageExecution(execution, {
      ownerId: "worker-b", claimTokenDigest: "b".repeat(64),
      now: "2026-08-26T00:06:00.000Z", leaseExpiresAt: "2026-08-26T00:11:00.000Z",
    })).toMatchObject({ outcome: "uncertain", execution: { state: "uncertain" } });
  });

  it("requires the exact claim token to finalize", () => {
    expect(() => finalizeStageExecution(execution, "b".repeat(64), "applied", "2026-08-26T00:02:00.000Z"))
      .toThrow("stage claim token mismatch");
    expect(finalizeStageExecution(execution, "a".repeat(64), "applied", "2026-08-26T00:02:00.000Z"))
      .toMatchObject({ state: "applied", finalizedAt: "2026-08-26T00:02:00.000Z" });
  });
});
