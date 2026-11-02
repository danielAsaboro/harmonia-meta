import { describe, expect, it } from "vitest";
import { digestReplayState, reduceReplayState } from "@/lib/recordReplay/state";
import type { ReplayEvent } from "@/lib/recordReplay/schema";

describe("replay terminal state", () => {
  it("preserves failures, recovery, approvals, and duplicate suppression deterministically", () => {
    const events = [
      { sequence: 0, capturedAt: "2026-08-26T10:00:00.000Z", offsetMs: 0, kind: "failure", payload: { jobId: "j", failureType: "transient_provider", code: "UNAVAILABLE", message: "retrying", retryable: true } },
      { sequence: 1, capturedAt: "2026-08-26T10:00:01.000Z", offsetMs: 1000, kind: "approval", payload: { jobId: "j", actionId: "a", decision: "approved", actor: "telegram_allowlist" } },
      { sequence: 2, capturedAt: "2026-08-26T10:00:02.000Z", offsetMs: 2000, kind: "effect_claim", payload: { jobId: "j", actionId: "a", outcome: "already_applied", receiptId: "r" } },
      { sequence: 3, capturedAt: "2026-08-26T10:00:03.000Z", offsetMs: 3000, kind: "stage_transition", payload: { jobId: "j", stage: "complete", status: "complete" } },
    ] as ReplayEvent[];
    const first = reduceReplayState(events);
    expect(first).toMatchObject({ lastSequence: 3, stage: "complete", status: "complete", duplicateEffectsSuppressed: 1 });
    expect(first.failures).toHaveLength(1);
    expect(digestReplayState(first)).toBe(digestReplayState(reduceReplayState(events)));
  });
});
