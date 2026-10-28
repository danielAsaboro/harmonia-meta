import { enqueueStageTrigger } from "./firestore";
import { dispatchStageOutboxRecord } from "./stageOutboxDispatcher";
import type { Stage } from "./types";

export async function queueStageTrigger(
  jobId: string,
  stage: Stage,
  attempt = 0,
  metadata: { completedStage?: Stage; note?: string } = {},
): Promise<string> {
  const outboxId = await enqueueStageTrigger(jobId, stage, attempt, metadata);
  try {
    await dispatchStageOutboxRecord(outboxId);
  } catch (error) {
    console.error("stage outbox immediate dispatch failed", {
      outboxId,
      errorType: error instanceof Error ? error.name : "unknown",
    });
  }
  return outboxId;
}
