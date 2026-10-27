import { PubSub } from "@google-cloud/pubsub";

import { getConfig } from "../config";
import { injectTraceContext } from "../telemetry";
import { validateTenantScope, type TenantScope } from "../tenancy";

let client: PubSub | null = null;
function pubsub(): PubSub {
  if (!client) client = new PubSub({ projectId: getConfig().GOOGLE_CLOUD_PROJECT });
  return client;
}

export interface DataWorkMessageInput {
  batchId: string;
  itemId: string;
  partitionIndex: number;
  processorVersion: string;
  manifestUri: string;
  manifestDigest: string;
}

export function buildDataWorkMessage(scope: TenantScope, input: DataWorkMessageInput) {
  const tenant = validateTenantScope(scope);
  const envelope = { schemaVersion: 1, ...tenant, ...input };
  const attributes = {
    workspaceId: tenant.workspaceId, brandId: tenant.brandId, batchId: input.batchId,
    itemId: input.itemId, processorVersion: input.processorVersion, schemaVersion: "1",
  };
  injectTraceContext(attributes);
  return { data: Buffer.from(JSON.stringify(envelope)), attributes };
}

export async function publishDataWork(scope: TenantScope, input: DataWorkMessageInput): Promise<string> {
  return pubsub().topic(getConfig().PUBSUB_DATA_TOPIC).publishMessage(buildDataWorkMessage(scope, input));
}
