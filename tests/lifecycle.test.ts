import { describe, expect, it } from "vitest";
import { deletionTombstone, planJobDeletion, planWorkspaceDeletion, retentionDeadline } from "@/lib/lifecycle";

const job = {
  id: "job-1", workspaceId: "workspace-1", brandId: "brand-1", status: "complete" as const,
};

describe("job data lifecycle", () => {
  it("requires exact confirmation and a terminal job", () => {
    expect(() => planJobDeletion({ job, confirmation: "wrong", reason: "user request" }))
      .toThrow("equal the job ID");
    expect(() => planJobDeletion({
      job: { ...job, status: "running" }, confirmation: "job-1", reason: "user request",
    })).toThrow("active jobs");
  });

  it("honors retention holds", () => {
    expect(() => planJobDeletion({
      job: { ...job, retentionHold: true }, confirmation: "job-1", reason: "cleanup",
    })).toThrow("retention hold");
  });

  it("creates a metadata-only tombstone without job content", () => {
    const plan = planJobDeletion(
      { job, confirmation: "job-1", reason: " operator erasure request " },
      new Date("2026-08-26T00:00:00Z"),
    );
    const tombstone = deletionTombstone(plan, "operator-1", new Date("2026-08-26T00:01:00Z"));
    expect(tombstone).toEqual(expect.objectContaining({
      jobId: "job-1", reason: "operator erasure request", contentErased: true,
    }));
    expect(JSON.stringify(tombstone)).not.toContain("draft");
    expect(JSON.stringify(tombstone)).not.toContain("transcript");
  });

  it("sets a bounded deterministic retention deadline", () => {
    expect(retentionDeadline(new Date("2026-08-26T00:00:00Z"), 90))
      .toBe("2026-11-24T00:00:00.000Z");
    expect(() => retentionDeadline(new Date(), 0)).toThrow("invalid retention period");
  });

  it("requires a deliberate workspace erasure phrase", () => {
    expect(() => planWorkspaceDeletion("workspace-1", "workspace-1", "closure"))
      .toThrow("DELETE plus");
    expect(planWorkspaceDeletion(
      "workspace-1", "DELETE workspace-1", " account closure ",
      new Date("2026-08-26T00:00:00Z"),
    )).toMatchObject({ workspaceId: "workspace-1", reason: "account closure" });
  });
});
