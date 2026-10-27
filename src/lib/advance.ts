import { appendEvent, getJob, markFailed, notifyPermanentFailure, transitionStageWithOutbox } from "./firestore";
import { dispatchStageOutboxRecord } from "./stageOutboxDispatcher";
import { assertTransition, nextStage } from "./stages";
import type { Stage } from "./types";
import type { FailureSubmission } from "./contracts";

/**
 * Single place where a completed stage result advances the pipeline:
 * persist the new stage, append an audit event, publish the next Pub/Sub
 * trigger. Called only after the caller has persisted its stage payload.
 */
export async function advance(
  jobId: string,
  completedStage: Stage,
  note: string,
): Promise<void> {
  const job = await getJob(jobId);
  assertTransition(job.stage, completedStage);
  const next = nextStage(completedStage);
  if (!next) throw new Error(`no successor for stage '${completedStage}'`);
  const outboxId = await transitionStageWithOutbox(jobId, completedStage, next, note);
  try {
    await dispatchStageOutboxRecord(outboxId);
  } catch (error) {
    // The transition and pending trigger are already durable. The external tick retries it.
    console.error("stage outbox immediate dispatch failed", { outboxId, errorType: error instanceof Error ? error.name : "unknown" });
  }
}

export async function recordFailure(
  failure: FailureSubmission,
): Promise<void> {
  await markFailed(failure);
  await appendEvent(
    failure.jobId,
    failure.stage as Stage,
    `${failure.retryable ? "retryable failure" : "permanent failure"} [${failure.category}/${failure.code}]: ${failure.publicMessage}`,
    "system",
    { operationId: failure.operationId, traceId: failure.traceId, activity: {
      kind: failure.retryable ? "retry" : "failure",
      status: failure.retryable ? "retrying" : "failed",
      role: (failure.details.role as
        | "harmonia_intent_router" | "nimi_analyst" | "ryan_strategist"
        | "temi_editorial_planner" | "noni_copywriter" | "dara_editor"
        | "noni_artifact_producer" | "dara_artifact_editor"
        | "maya_trend_researcher" | "maya_presenter" | "nova_liaison")
        ?? "coordinator_system",
      code: failure.code,
      category: failure.category,
      publicMessage: failure.publicMessage,
      ...(typeof failure.details.path === "string" ? { path: failure.details.path } : {}),
      retryable: failure.retryable,
      attempt: failure.attempt,
      maxAttempts: failure.maxAttempts,
    } },
  );
  if (!failure.retryable) {
    await notifyPermanentFailure(failure.jobId, failure.stage as Stage, failure.publicMessage);
  }
}
