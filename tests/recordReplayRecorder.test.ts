import { describe, expect, it } from "vitest";
import { GOLDEN_SCENARIOS } from "@/lib/recordReplay/scenarios";
import { recordAuthenticatedRun, validatePrivateReplayOutputPath } from "@/lib/recordReplay/recorder";

const base = { bundleId: "candidate-1", scenario: "success" as const, sourceRunId: "run", sourceJobId: "job", capturedAt: "2026-08-26T10:00:00.000Z", captureEndedAt: "2026-08-26T10:00:01.000Z", sourceCaptureAuthorized: true, observations: [{ sequence: 0, capturedAt: "2026-08-26T10:00:00.000Z", offsetMs: 0, kind: "stage_transition", payload: { jobId: "job", stage: "complete", status: "complete" } }] };
describe("authenticated run recorder", () => {
  it("creates private signed candidates and aborts on any secret", () => {
    const bundle = recordAuthenticatedRun(base); expect(bundle.release).toBe("private_candidate"); expect(bundle.integrity.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(() => recordAuthenticatedRun({ ...base, observations: [{ ...base.observations[0], payload: { ...base.observations[0].payload, authorizationHeader: "Bearer secretsecret" } }] })).toThrow(/forbidden/i);
  });
  it("never fabricates golden scenarios", () => { expect(GOLDEN_SCENARIOS).toHaveLength(9); expect(GOLDEN_SCENARIOS.every((entry) => entry.status === "not_captured" && !("bundlePath" in entry))).toBe(true); });
  it("refuses to write candidates inside the public repository", () => {
    expect(() => validatePrivateReplayOutputPath(process.cwd(), `${process.cwd()}/golden.json`)).toThrow(/outside/i);
    expect(validatePrivateReplayOutputPath(process.cwd(), `${process.cwd()}/../submission/evidence/replay/golden.json`)).toContain("submission/evidence/replay");
  });
});
