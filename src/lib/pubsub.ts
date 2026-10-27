import { PubSub } from "@google-cloud/pubsub";
import { getConfig } from "./config";
import { injectTraceContext } from "./telemetry";
import { eventPayloadDigest, type EventEnvelope } from "./eventInbox";
import type { StageOutboxRecord } from "./stageOutbox";
import type { ProductionOperationOutboxRecord } from "./productionPlanStore";
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

export async function publishProductionOperation(
  scope: TenantScope,
  record: ProductionOperationOutboxRecord,
): Promise<string> {
  return pubsub().topic(getConfig().PUBSUB_PRODUCTION_TOPIC).publishMessage(
    buildProductionMessage(scope, record),
  );
}

export function buildProductionMessage(
  scope: TenantScope,
  record: ProductionOperationOutboxRecord,
): BuiltStageMessage {
  const tenant = validateTenantScope(scope);
  if (record.workspaceId !== tenant.workspaceId || record.brandId !== tenant.brandId) {
    throw new Error("production outbox tenant mismatch");
  }
  const payload = {
    workspaceId: tenant.workspaceId,
    brandId: tenant.brandId,
    planId: record.planId,
    planRevision: record.planRevision,
    planDigest: record.planDigest,
    operationId: record.operationId,
    internalRun: record.internalRun,
  };
  const attributes: Record<string, string> = {
    workspaceId: tenant.workspaceId,
    brandId: tenant.brandId,
    planId: record.planId,
    planRevision: String(record.planRevision),
    planDigest: record.planDigest,
    operationId: record.operationId,
    internalRun: String(record.internalRun),
    outboxId: record.id,
  };
  injectTraceContext(attributes);
  return {
    data: Buffer.from(JSON.stringify(payload)),
    attributes,
  };
}
