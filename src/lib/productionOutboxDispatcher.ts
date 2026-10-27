import { createHash, randomBytes } from "node:crypto";

import { publishProductionOperation } from "./pubsub";
import {
  claimProductionOutbox,
  finalizeProductionOutboxPublish,
  listDispatchableProductionOutbox,
  releaseProductionOutbox,
} from "./productionPlanStore";
import { currentTenant } from "./tenancy";

export type ProductionOutboxDispatchResult =
  | { id: string; outcome: "published"; pubsubMessageId: string }
  | { id: string; outcome: "in_progress" | "already_published" };

export async function dispatchProductionOutboxRecord(id: string): Promise<ProductionOutboxDispatchResult> {
  const tokenDigest = createHash("sha256").update(randomBytes(32)).digest("hex");
  const decision = await claimProductionOutbox(id, tokenDigest);
  if (decision.outcome !== "publish") return { id, outcome: decision.outcome };
  try {
    const messageId = await publishProductionOperation(currentTenant(), decision.record);
    await finalizeProductionOutboxPublish(id, tokenDigest, messageId);
    return { id, outcome: "published", pubsubMessageId: messageId };
  } catch (error) {
    await releaseProductionOutbox(id, tokenDigest);
    throw error;
  }
}

export async function dispatchProductionOutbox(limit = 20): Promise<ProductionOutboxDispatchResult[]> {
  const records = await listDispatchableProductionOutbox(limit);
  const results: ProductionOutboxDispatchResult[] = [];
  for (const record of records) results.push(await dispatchProductionOutboxRecord(record.id));
  return results;
}
