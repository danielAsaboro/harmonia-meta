import type { Stage } from "./types";

/**
 * Linear stage pipeline for the first vertical slice. Each entry maps a stage
 * to the stage that Pub/Sub should trigger once the current stage completes.
 */
const NEXT_STAGE: Partial<Record<Stage, Stage>> = {
  queued: "collect_sources",
  collect_sources: "extract_sources",
  extract_sources: "understand",
  understand: "strategize",
  strategize: "awaiting_strategy_approval",
  plan: "draft",
  draft: "awaiting_approval",
};

export function nextStage(current: Stage): Stage | null {
  return NEXT_STAGE[current] ?? null;
}

export function isKnownStage(stage: string): stage is Stage {
  return [
    "queued",
    "collect_sources",
    "extract_sources",
    "awaiting_source_resolution",
    "understand",
    "strategize",
    "awaiting_strategy_approval",
    "plan",
    "draft",
    "awaiting_approval",
    "publish",
    "verify",
    "learn",
    "complete",
    "failed",
  ].includes(stage);
}

export class TransitionError extends Error {}

/**
 * Guard applied server-side before accepting an agent result or publishing
 * the next trigger. Prevents out-of-order execution under redelivery.
 */
export function assertTransition(jobStage: Stage, incomingStage: Stage): void {
  if (jobStage !== incomingStage) {
    throw new TransitionError(
      `job is at stage '${jobStage}' but result arrived for stage '${incomingStage}'`,
    );
  }
}
