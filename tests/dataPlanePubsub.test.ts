import { describe, expect, it } from "vitest";

import { buildDataWorkMessage } from "@/lib/dataPlane/pubsub";

describe("data-plane Pub/Sub envelope", () => {
  it("binds tenant, manifest, processor, batch, and work item identity", () => {
    const built = buildDataWorkMessage({ workspaceId: "workspace-1", brandId: "brand-1" }, {
      batchId: "batch-1", itemId: "item-1", partitionIndex: 9, processorVersion: "analysis-v1",
      manifestUri: "gs://harmonia-data/manifests/batch-1.json", manifestDigest: "a".repeat(64),
    });
    expect(built.attributes).toMatchObject({ workspaceId: "workspace-1", brandId: "brand-1", batchId: "batch-1", itemId: "item-1", processorVersion: "analysis-v1" });
    expect(JSON.parse(built.data.toString())).toMatchObject({ schemaVersion: 1, partitionIndex: 9, manifestDigest: "a".repeat(64) });
  });
});
