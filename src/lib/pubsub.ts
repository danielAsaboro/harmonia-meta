import { PubSub } from "@google-cloud/pubsub";
import { getConfig } from "./config";
import { injectTraceContext } from "./telemetry";
import { eventPayloadDigest, type EventEnvelope } from "./eventInbox";
import type { StageOutboxRecord } from "./stageOutbox";
import type { TenantScope } from "./tenancy";
import { validateTenantScope } from "./tenancy";

let client: PubSub | null = null;

function pubsub(): PubSub {
  if (!client) {
    client = new PubSub({ projectId: getConfig().GOOGLE_CLOUD_PROJECT });
  }
  return client;
}

export type StageMessage = EventEnvelope;

export interface BuiltStageMessage {
  data: Buffer;
  attributes: Record<string, string>;
}

export function buildStageMessage(
  scope: TenantScope,
  record: StageOutboxRecord,
): BuiltStageMessage {
  const tenant = validateTenantScope(scope);
  if (record.workspaceId !== tenant.workspaceId || record.brandId !== tenant.brandId) {
    throw new Error("stage outbox tenant mismatch");
  }
  const payload = { stage: record.stage };
  const envelope: StageMessage = {
    schemaVersion: record.schemaVersion,
    source: "stage_outbox",
    sourceEventId: record.sourceEventId,
    workspaceId: tenant.workspaceId,
    brandId: tenant.brandId,
    jobId: record.jobId,
    eventType: "stage.requested",
    operationId: record.operationId,
    correlationId: record.correlationId,
    ...(record.causationId ? { causationId: record.causationId } : {}),
    attempt: record.attempt,
    trust: "system",
    occurredAt: record.createdAt,
    payload,
    payloadDigest: eventPayloadDigest(payload),
  };
  const attributes: Record<string, string> = {
    workspaceId: tenant.workspaceId,
    brandId: tenant.brandId,
    jobId: record.jobId,
    stage: record.stage,
    sourceEventId: record.sourceEventId,
    operationId: record.operationId,
    schemaVersion: String(record.schemaVersion),
  };
  injectTraceContext(attributes);
  return {
    data: Buffer.from(JSON.stringify(envelope)),
    attributes,
  };
}

export async function publishStage(
  scope: TenantScope,
  record: StageOutboxRecord,
): Promise<string> {
  const topic = pubsub().topic(getConfig().PUBSUB_STAGE_TOPIC);
  const messageId = await topic.publishMessage(buildStageMessage(scope, record));
  return messageId;
}
