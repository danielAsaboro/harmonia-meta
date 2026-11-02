import { describe, expect, it } from "vitest";

import {
  initialOperationalFeedState,
  parseOperationalUpdate,
  reduceOperationalUpdate,
} from "@/lib/operations/updateFeed";
import type { JobShell } from "@/lib/operations/jobShell";
import type { AttentionItem } from "@/lib/operations/attention";

const shell: JobShell = {
  jobId: "job-1",
  lifecycle: "active",
  stage: "understand",
  controlState: "running",
  controlEpoch: 0,
  progress: { completedSteps: 3, totalSteps: 12 },
  backgroundLiveness: "working",
  lastEventSequence: 8,
  lastProgressAt: "2026-08-31T00:00:00.000Z",
  approvalCount: 0,
  attentionCount: 0,
  unknownEffectCount: 0,
  needsAttention: false,
};

const attention: AttentionItem = {
  id: "attention:approval:action-1",
  kind: "approval",
  sourceId: "action-1",
  workspaceId: "workspace-1",
  brandId: "brand-1",
  jobId: "job-1",
  state: "open",
  title: "Approve publication",
  reason: "Publishing requires operator approval.",
  createdAt: "2026-08-31T00:00:00.000Z",
  priority: 60,
  actionHref: "/dashboard/monitoring?tab=jobs&job=job-1&focus=approval&source=action-1",
};

describe("operational update feed", () => {
  it("reduces contiguous shell and attention updates", () => {
    let state = initialOperationalFeedState();
    state = reduceOperationalUpdate(state, {
      type: "job_shell_upserted", sequence: 0, occurredAt: "2026-08-31T00:00:01.000Z", shell,
    });
    state = reduceOperationalUpdate(state, {
      type: "attention_upserted", sequence: 1, occurredAt: "2026-08-31T00:00:02.000Z", item: attention,
    });

    expect(state.snapshotSequence).toBe(1);
    expect(state.jobs["job-1"]).toEqual(shell);
    expect(state.attention[attention.id]).toEqual(attention);
  });

  it("ignores replayed updates but rejects a missing sequence", () => {
    const event = {
      type: "job_shell_upserted" as const,
      sequence: 0,
      occurredAt: "2026-08-31T00:00:01.000Z",
      shell,
    };
    const once = reduceOperationalUpdate(initialOperationalFeedState(), event);
    expect(reduceOperationalUpdate(once, event)).toEqual(once);
    expect(() => reduceOperationalUpdate(once, { ...event, sequence: 2 })).toThrow("sequence gap");
  });

  it("removes projections explicitly", () => {
    let state = reduceOperationalUpdate(initialOperationalFeedState(), {
      type: "job_shell_upserted", sequence: 0, occurredAt: "2026-08-31T00:00:01.000Z", shell,
    });
    state = reduceOperationalUpdate(state, {
      type: "job_shell_removed", sequence: 1, occurredAt: "2026-08-31T00:00:02.000Z", jobId: "job-1",
    });
    expect(state.jobs).toEqual({});
  });

  it("rejects malformed persisted events at the replay boundary", () => {
    expect(() => parseOperationalUpdate({
      type: "job_shell_removed",
      sequence: -1,
      occurredAt: "not-a-date",
      jobId: "",
    })).toThrow();
  });
});
