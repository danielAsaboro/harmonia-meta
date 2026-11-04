import { describe, expect, it } from "vitest";
import { applyStepProgress, finishRun, newOnboardingRun } from "@/lib/onboardingRuns";

describe("website onboarding runs", () => {
  it("starts every step pending", () => {
    const run = newOnboardingRun("cal.com", "2026-11-04T00:00:00.000Z");
    expect(run.status).toBe("running");
    expect(run.steps.map((step) => [step.id, step.status])).toEqual([
      ["fetching_site", "pending"], ["reading_site", "pending"], ["researching_competitors", "pending"], ["researching_customers", "pending"], ["writing_brief", "pending"],
    ]);
  });

  it("moves a step forward with its detail and never reopens it", () => {
    let run = newOnboardingRun("cal.com", "t0");
    run = applyStepProgress(run, { step: "fetching_site", status: "running" }, "t1");
    run = applyStepProgress(run, { step: "fetching_site", status: "done", detail: "Read 5 pages: home, pricing" }, "t2");
    run = applyStepProgress(run, { step: "fetching_site", status: "running" }, "t3");
    expect(run.steps[0]).toEqual({ id: "fetching_site", status: "done", startedAt: "t1", finishedAt: "t2", detail: "Read 5 pages: home, pricing" });
  });

  it("marks the running step failed when the run fails", () => {
    let run = applyStepProgress(newOnboardingRun("cal.com", "t0"), { step: "fetching_site", status: "running" }, "t1");
    run = finishRun(run, { error: "website onboarding failed: HTTP 502" }, "t2");
    expect(run.status).toBe("failed");
    expect(run.error).toBe("website onboarding failed: HTTP 502");
    expect(run.steps[0].status).toBe("failed");
    expect(run.steps[1].status).toBe("pending");
    expect(applyStepProgress(run, { step: "reading_site", status: "running" }, "t3")).toBe(run);
  });

  it("completes every step when the brief is saved", () => {
    const run = finishRun(newOnboardingRun("cal.com", "t0"), { briefDigest: "d".repeat(64) }, "t1");
    expect(run.status).toBe("done");
    expect(run.briefDigest).toBe("d".repeat(64));
    expect(run.steps.every((step) => step.status === "done")).toBe(true);
  });
});
