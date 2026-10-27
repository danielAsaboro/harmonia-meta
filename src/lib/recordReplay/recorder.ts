import { signReplayBundle } from "./integrity";
import { sanitizeReplayObservation } from "./sanitize";
import { digestReplayState, reduceReplayState } from "./state";
import type { ReplayBundle, ReplayScenario, UnsignedReplayBundle } from "./schema";
import path from "node:path";

export interface AuthenticatedRunInput { bundleId: string; scenario: ReplayScenario; sourceRunId: string; sourceJobId?: string; capturedAt: string; captureEndedAt: string; sourceCaptureAuthorized: boolean; observations: unknown[] }
export function recordAuthenticatedRun(input: AuthenticatedRunInput): ReplayBundle {
  const events = input.observations.map((observation) => sanitizeReplayObservation(observation, { sourceCaptureAuthorized: input.sourceCaptureAuthorized })).sort((a, b) => a.sequence - b.sequence);
  const unsigned: UnsignedReplayBundle = { schema: "harmonia.authenticated-replay", schemaVersion: "1.0.0", bundleId: input.bundleId, executionMode: "recorded_replay", evidenceClassification: "historical_replay", scenario: input.scenario, capturedAt: input.capturedAt, captureEndedAt: input.captureEndedAt, release: "private_candidate", provenance: { sourceRunId: input.sourceRunId, sourceJobId: input.sourceJobId, environment: "authenticated_cloud", sanitizerVersion: "1.0.0", sourceCaptureAuthorized: input.sourceCaptureAuthorized }, events, terminalStateDigest: digestReplayState(reduceReplayState(events)) };
  return signReplayBundle(unsigned);
}
export function validatePrivateReplayOutputPath(repositoryRoot: string, outputPath: string): string {
  const root = path.resolve(repositoryRoot); const output = path.resolve(outputPath);
  if (output === root || output.startsWith(`${root}${path.sep}`)) throw new Error("private replay candidates must be written outside the public repository");
  if (path.extname(output) !== ".json") throw new Error("replay candidate output must be a JSON file");
  return output;
}
