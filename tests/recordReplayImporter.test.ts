import { describe, expect, it } from "vitest";
import { signReplayBundle } from "@/lib/recordReplay/integrity";
import { importReplayBundle } from "@/lib/recordReplay/importer";
import { digestReplayState, reduceReplayState } from "@/lib/recordReplay/state";
import type { UnsignedReplayBundle } from "@/lib/recordReplay/schema";

export function replayTestBundle(release: "private_candidate" | "approved_public_bundle" = "private_candidate") {
  const events = [{ sequence: 0, capturedAt: "2026-08-26T10:00:00.000Z", offsetMs: 0, kind: "stage_transition", payload: { jobId: "j", stage: "complete", status: "complete" } }] as const;
  return signReplayBundle({ schema: "harmonia.authenticated-replay", schemaVersion: "1.0.0", bundleId: "bundle-1", executionMode: "recorded_replay", evidenceClassification: "historical_replay", scenario: "success", capturedAt: "2026-08-26T10:00:00.000Z", captureEndedAt: "2026-08-26T10:00:01.000Z", release, provenance: { sourceRunId: "r", sourceJobId: "j", environment: "authenticated_cloud", sanitizerVersion: "1.0.0", sourceCaptureAuthorized: true }, events: [...events], terminalStateDigest: digestReplayState(reduceReplayState([...events])) } as UnsignedReplayBundle);
}
describe("replay importer", () => {
  it("rejects tampering, terminal mismatch, and private bundles at public boundary", () => {
    const bundle = replayTestBundle();
    expect(() => importReplayBundle(JSON.stringify({ ...bundle, bundleId: "tampered" }), { destination: "private" })).toThrow(/integrity/i);
    const { integrity: _integrity, ...unsigned } = bundle;
    const mismatch = signReplayBundle({ ...unsigned, terminalStateDigest: "a".repeat(64) } as UnsignedReplayBundle);
    expect(() => importReplayBundle(JSON.stringify(mismatch), { destination: "private" })).toThrow(/terminal/i);
    expect(() => importReplayBundle(JSON.stringify(bundle), { destination: "public" })).toThrow(/public/i);
  });
  it("deep freezes verified imports", () => { const imported = importReplayBundle(JSON.stringify(replayTestBundle()), { destination: "private" }); expect(Object.isFrozen(imported)).toBe(true); expect(Object.isFrozen(imported.events)).toBe(true); });
});
