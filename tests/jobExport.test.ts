import { describe, expect, it } from "vitest";
import { jobObservations } from "@/lib/recordReplay/jobExport";
import { recordAuthenticatedRun } from "@/lib/recordReplay/recorder";
import { importReplayBundle } from "@/lib/recordReplay/importer";
import { signReplayBundle } from "@/lib/recordReplay/integrity";
import { summarizeRun } from "@/lib/proof";

const at = (minute: number) => `2026-11-04T14:${String(minute).padStart(2, "0")}:00.000Z`;

const job = {
  id: "job-1", createdAt: at(0), updatedAt: at(9), stage: "verify", status: "awaiting_approval",
  sourceAnalysis: { moments: [{ id: "m1", title: "Nine days to forty hours", startSec: 12, endSec: 19.5 }] },
  contentArtifacts: [{ id: "x1", payload: { kind: "x_post", text: "Activation took nine days. Now it takes forty hours." } }],
  actions: [{ id: "a1", type: "publish_x_post", state: "executed", approvalState: "approved" }],
  verifications: [{ receiptId: "r1", verified: true, method: "official_api_readback", checkedAt: at(9), traceId: "t" }],
} as never;

const events = [
  { id: "e1", jobId: "job-1", at: at(1), stage: "understand", message: "m", actor: "agent", operationId: "o", traceId: "t1" },
  { id: "e2", jobId: "job-1", at: at(2), stage: "understand", message: "m", actor: "agent", operationId: "o", traceId: "t1",
    activity: { kind: "handoff", status: "succeeded", role: "nimi_analyst", fromRole: "nimi_analyst", toRole: "ryan_strategist", publicMessage: "1 grounded moment" } },
  { id: "e3", jobId: "job-1", at: at(4), stage: "strategize", message: "m", actor: "agent", operationId: "o", traceId: "t2" },
  { id: "e4", jobId: "job-1", at: null, stage: "plan", message: "m", actor: "agent", operationId: "o", traceId: "t3" },
] as never;

const usage = [
  { id: "u1", jobId: "job-1", model: "muse-wonder-1.0", inputUnits: 5000, outputUnits: 2000, unitType: "tokens", estimatedCostUsd: "0.060000", traceId: "t2", createdAt: at(5) },
  { id: "u2", jobId: "job-1", model: "sam-3.1", inputUnits: 40, outputUnits: 0, unitType: "video_frames", estimatedCostUsd: "0.010000", traceId: "t4", createdAt: at(6) },
] as never;

const receipts = [{ id: "r1", jobId: "job-1", actionId: "a1", outcome: "applied", performedAt: at(8), traceId: "t5", artifact: { digest: "d" } }] as never;

describe("job export", () => {
  it("turns a persisted job into ordered, allowlisted observations a public bundle accepts", () => {
    const observations = jobObservations({ job, events, usage, receipts });
    expect(observations.map((item) => item.kind)).toEqual([
      "stage_transition", "specialist_handoff", "moment", "stage_transition", "usage", "receipt", "draft", "action", "approval", "verification", "job_snapshot",
    ]);
    expect(observations.every((item, index) => item.sequence === index)).toBe(true);

    const candidate = recordAuthenticatedRun({
      bundleId: "job-1-export", scenario: "success", sourceRunId: "job-1", sourceJobId: "job-1",
      capturedAt: observations[0].capturedAt, captureEndedAt: observations.at(-1)!.capturedAt,
      sourceCaptureAuthorized: true, environment: "local_emulator", observations,
    });
    const { integrity: _integrity, ...unsigned } = candidate;
    void _integrity;
    const run = summarizeRun(importReplayBundle(signReplayBundle({ ...unsigned, release: "approved_public_bundle" }), { destination: "public" }));

    expect(run.environment).toBe("local_emulator");
    expect(run.stages).toEqual(["understand", "strategize", "verify"]);
    expect(run.cost).toEqual([{ model: "muse-wonder-1.0", inputTokens: 5000, outputTokens: 2000, usd: 0.06 }]);
    expect(run.receipts).toEqual([{ actionId: "a1", outcome: "applied", verified: true }]);
    expect(run.drafts[0].text).toContain("forty hours");
  });

  it("refuses drafts without explicit source-capture authorization", () => {
    const observations = jobObservations({ job, events, usage, receipts });
    expect(() => recordAuthenticatedRun({
      bundleId: "b", scenario: "success", sourceRunId: "job-1", capturedAt: at(0), captureEndedAt: at(9),
      sourceCaptureAuthorized: false, observations,
    })).toThrow(/source capture authorization/);
  });
});
