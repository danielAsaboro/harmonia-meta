import { describe, expect, it } from "vitest";

import { deriveJobShell } from "@/lib/operations/jobShell";

const base = {
  job: {
    id: "job-1",
    status: "running" as const,
    stage: "understand" as const,
    controlState: "running" as const,
    controlEpoch: 3,
    updatedAt: "2026-08-31T00:00:00.000Z",
  },
  pendingApprovalCount: 0,
  attentionCount: 0,
  unknownEffectCount: 0,
  lastEventSequence: 12,
};

describe("job shell derivation", () => {
  it("keeps uncertain effects visible above approvals, pause, and terminal job status", () => {
    const shell = deriveJobShell({
      ...base,
      job: { ...base.job, status: "failed", controlState: "paused" },
      pendingApprovalCount: 2,
      attentionCount: 1,
      unknownEffectCount: 1,
    });

    expect(shell.lifecycle).toBe("uncertain");
    expect(shell.needsAttention).toBe(true);
    expect(shell.attentionCount).toBe(4);
  });

  it("surfaces operator work before pause and failure", () => {
    expect(deriveJobShell({
      ...base,
      job: { ...base.job, status: "failed", controlState: "paused" },
      pendingApprovalCount: 1,
    }).lifecycle).toBe("needs_you");
  });

  it("derives paused, failed, scheduled, settled, and active states deterministically", () => {
    expect(deriveJobShell({ ...base, job: { ...base.job, controlState: "paused" } }).lifecycle).toBe("paused");
    expect(deriveJobShell({ ...base, job: { ...base.job, status: "failed" } }).lifecycle).toBe("failed");
    expect(deriveJobShell({ ...base, scheduledFor: "2026-09-01T10:00:00.000Z" }).lifecycle).toBe("scheduled");
    expect(deriveJobShell({ ...base, job: { ...base.job, status: "complete", stage: "complete" } }).lifecycle).toBe("settled");
    expect(deriveJobShell(base).lifecycle).toBe("active");
  });

  it("reports bounded stage and explicit plan progress", () => {
    const inferred = deriveJobShell(base);
    expect(inferred.progress).toEqual({ completedSteps: 4, totalSteps: 13 });
    expect(inferred.backgroundLiveness).toBe("working");

    const explicit = deriveJobShell({
      ...base,
      currentStep: "Extracting claims",
      completedSteps: 4,
      totalSteps: 7,
      backgroundLiveness: "monitoring",
      nextAttemptAt: "2026-08-31T00:05:00.000Z",
    });
    expect(explicit.currentStep).toBe("Extracting claims");
    expect(explicit.progress).toEqual({ completedSteps: 4, totalSteps: 7 });
    expect(explicit.backgroundLiveness).toBe("monitoring");
    expect(explicit.nextAttemptAt).toBe("2026-08-31T00:05:00.000Z");
  });

  it("rejects invalid counters instead of emitting a misleading shell", () => {
    expect(() => deriveJobShell({ ...base, lastEventSequence: -2 })).toThrow("last event sequence");
    expect(() => deriveJobShell({ ...base, completedSteps: 8, totalSteps: 7 })).toThrow("progress");
  });
});
