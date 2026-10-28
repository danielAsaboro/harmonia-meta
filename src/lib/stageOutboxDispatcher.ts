import { createHash, randomBytes } from "node:crypto";
import {
  claimStageOutbox,
  finalizeStageOutboxPublish,
  listDispatchableStageOutbox,
  releaseStageOutbox,
} from "./firestore";
import { publishStage } from "./pubsub";
import { currentTenant } from "./tenancy";

export type StageOutboxDispatchResult =
  | { id: string; outcome: "published"; pubsubMessageId: string }
  | { id: string; outcome: "in_progress" | "already_published" };

export async function dispatchStageOutboxRecord(id: string): Promise<StageOutboxDispatchResult> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenDigest = createHash("sha256").update(rawToken).digest("hex");
  const decision = await claimStageOutbox(id, tokenDigest);
  if (decision.outcome !== "publish") return { id, outcome: decision.outcome };
  try {
    const messageId = await publishStage(
      currentTenant(),
      decision.record,
    );
    await finalizeStageOutboxPublish(id, tokenDigest, messageId);
    return { id, outcome: "published", pubsubMessageId: messageId };
  } catch (error) {
    // Pub/Sub duplicate delivery is safe because the stage lease is durable. Releasing an
    // ambiguous publication claim therefore favors eventual delivery without duplicating effects.
    await releaseStageOutbox(id, tokenDigest);
    throw error;
  }
}

export async function dispatchStageOutbox(limit = 20): Promise<StageOutboxDispatchResult[]> {
  const records = await listDispatchableStageOutbox(limit);
  const results: StageOutboxDispatchResult[] = [];
  for (const record of records) results.push(await dispatchStageOutboxRecord(record.id));
  return results;
}
