import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const deploy = readFileSync(new URL("../infra/deploy.sh", import.meta.url), "utf8");
const setup = readFileSync(new URL("../infra/setup.sh", import.meta.url), "utf8");
const indexes = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8"));

describe("cloud infrastructure scripts", () => {
  it("allows a production operation to outlive the worker's longest media subprocess", () => {
    expect(deploy).toContain("--timeout 1200");
    expect(deploy).not.toContain("--timeout 300");
  });

  it("updates an existing push subscription instead of silently keeping stale settings", () => {
    expect(deploy).toContain("subscriptions describe harmonia-stages-agent-push");
    expect(deploy).toContain("subscriptions update harmonia-stages-agent-push");
    expect(deploy).toContain("subscriptions describe harmonia-production-agent-push");
    expect(deploy).toContain("subscriptions update harmonia-production-agent-push");
    expect(deploy).not.toContain('2>/dev/null || echo "subscription exists"');
  });

  it("uses a dedicated push identity instead of the web runtime identity", () => {
    expect(setup).toContain("harmonia-pubsub-push");
    expect(deploy).toContain("harmonia-pubsub-push@${PROJECT_ID}.iam.gserviceaccount.com");
  });

  it("grants the Pub/Sub service agent DLQ publisher and source subscriber roles", () => {
    const serviceAgent = 'service-${PROJECT_NUMBER}@gcp-sa-pubsub.iam.gserviceaccount.com';
    expect(deploy).toContain(serviceAgent);
    expect(deploy).toMatch(/topics add-iam-policy-binding harmonia-stages-dlq[\s\S]*roles\/pubsub\.publisher/);
    expect(deploy).toMatch(/subscriptions add-iam-policy-binding harmonia-stages-agent-push[\s\S]*service-\$\{PROJECT_NUMBER\}[\s\S]*roles\/pubsub\.subscriber/);
    expect(deploy).toMatch(/subscriptions add-iam-policy-binding harmonia-production-agent-push[\s\S]*service-\$\{PROJECT_NUMBER\}[\s\S]*roles\/pubsub\.subscriber/);
  });

  it("does not grant the worker direct object-admin access it does not use", () => {
    expect(setup).not.toMatch(/for sa in harmonia-web harmonia-agent; do[\s\S]{0,180}roles\/storage\.objectAdmin/);
    expect(setup).toMatch(/harmonia-web@\$\{PROJECT_ID\}[\s\S]{0,180}roles\/storage\.objectAdmin/);
  });

  it("deploys the composite index required for ordered expired-lease recovery", () => {
    expect(indexes.indexes).toContainEqual({
      collectionGroup: "operations",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "state", order: "ASCENDING" },
        { fieldPath: "leaseExpiresAt", order: "ASCENDING" },
        { fieldPath: "id", order: "ASCENDING" },
      ],
    });
    expect(indexes.indexes).toContainEqual({
      collectionGroup: "production_operation_outbox",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "state", order: "ASCENDING" },
        { fieldPath: "availableAt", order: "ASCENDING" },
      ],
    });
    expect(indexes.indexes).toContainEqual({
      collectionGroup: "production_operation_outbox",
      queryScope: "COLLECTION",
      fields: [
        { fieldPath: "state", order: "ASCENDING" },
        { fieldPath: "publishLeaseExpiresAt", order: "ASCENDING" },
      ],
    });
    expect(setup).toContain("firestore indexes composite create");
    expect(setup).toContain("--collection-group=operations");
    expect(setup).toContain("--collection-group=production_operation_outbox");
  });

  it("bounds redelivery and runs recovery on its own authenticated wake", () => {
    expect(deploy).toContain("--min-retry-delay 10s");
    expect(deploy).toContain("--max-retry-delay 600s");
    expect(deploy).toContain("--message-retention-duration 7d");
    expect(deploy).toContain("harmonia-durable-recovery");
    expect(deploy).toContain("/durable/recover");
    expect(deploy).toContain("DURABLE_RECOVERY_LIMIT=");
    expect(deploy).toContain("DURABLE_RECOVERY_DEADLINE_SECONDS=");
    expect(deploy).toContain("${WEB_URL}/api/health");
  });
});
