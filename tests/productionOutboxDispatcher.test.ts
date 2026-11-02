import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  claimProductionOutbox: vi.fn(),
  finalizeProductionOutboxPublish: vi.fn(),
  listDispatchableProductionOutbox: vi.fn(),
  releaseProductionOutbox: vi.fn(),
}));
const publisher = vi.hoisted(() => ({ publishProductionOperation: vi.fn() }));
vi.mock("@/lib/productionPlanStore", () => store);
vi.mock("@/lib/pubsub", () => publisher);
vi.mock("@/lib/tenancy", () => ({ currentTenant: () => ({ workspaceId: "workspace-1", brandId: "brand-1", principal: { kind: "service" } }) }));

import { dispatchProductionOutbox } from "@/lib/productionOutboxDispatcher";

describe("production operation outbox dispatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const record = {
      id: "outbox-1", workspaceId: "workspace-1", brandId: "brand-1",
      planId: "plan-1", jobId: "job-1", planRevision: 1, planDigest: "a".repeat(64),
      operationId: "plan-1:generate_video:scene-1", state: "pending",
      availableAt: "2026-08-31T12:00:00.000Z", publishAttempt: 0,
      createdAt: "2026-08-31T12:00:00.000Z", updatedAt: "2026-08-31T12:00:00.000Z",
    };
    store.listDispatchableProductionOutbox.mockResolvedValue([record]);
    store.claimProductionOutbox.mockResolvedValue({ outcome: "publish", record: { ...record, state: "publishing" } });
    publisher.publishProductionOperation.mockResolvedValue("message-1");
  });

  it("publishes the exact durable production wake and finalizes its outbox record", async () => {
    await expect(dispatchProductionOutbox(10)).resolves.toEqual([
      { id: "outbox-1", outcome: "published", pubsubMessageId: "message-1" },
    ]);
    expect(publisher.publishProductionOperation).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: "workspace-1", brandId: "brand-1" }),
      expect.objectContaining({ id: "outbox-1", operationId: "plan-1:generate_video:scene-1" }),
    );
    expect(store.finalizeProductionOutboxPublish).toHaveBeenCalledWith(
      "outbox-1", expect.any(String), "message-1",
    );
  });

  it("releases the publish lease when Pub/Sub publication fails", async () => {
    publisher.publishProductionOperation.mockRejectedValue(new Error("pubsub unavailable"));
    await expect(dispatchProductionOutbox(10)).rejects.toThrow("pubsub unavailable");
    expect(store.releaseProductionOutbox).toHaveBeenCalledWith("outbox-1", expect.any(String));
  });
});
