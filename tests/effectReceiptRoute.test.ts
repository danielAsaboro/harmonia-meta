import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendEvent: vi.fn(), finalizeEffectReceipt: vi.fn(), getJob: vi.fn(),
  transitionStageWithOutbox: vi.fn(), finalizeCommandReceipt: vi.fn(),
}));
vi.mock("@/lib/firestore", () => ({
  appendEvent: mocks.appendEvent,
  finalizeEffectReceipt: mocks.finalizeEffectReceipt,
  getJob: mocks.getJob,
  transitionStageWithOutbox: mocks.transitionStageWithOutbox,
}));
vi.mock("@/lib/effectCommandStore", () => ({ finalizeCommandReceipt: mocks.finalizeCommandReceipt }));
vi.mock("@/lib/stageOutboxDispatcher", () => ({ dispatchStageOutboxRecord: vi.fn() }));
vi.mock("@/lib/idempotency", () => ({ newId: () => "receipt-1" }));

import { POST } from "@/app/api/internal/receipt/route";

const operationId = "job:job-1:effect:command-1";
const body = {
  commandId: "command-1", jobId: "job-1", actionId: "action-1",
  actionType: "publish_x_post", idempotencyKey: "a".repeat(64),
  operationId, traceId: "b".repeat(32), claimToken: "owner-1",
  outcome: "applied", detail: { id: "post-1" },
};

function request(withFence: boolean) {
  return new Request("http://localhost/api/internal/receipt", {
    method: "POST",
    headers: {
      authorization: "Bearer test-internal-token", "content-type": "application/json",
      "x-workspace-id": "workspace-1", "x-brand-id": "brand-1",
      ...(withFence ? {
        "x-harmonia-operation-id": operationId,
        "x-harmonia-operation-epoch": "2",
      } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("effect command receipt route", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.AGENT_SERVICE_URL = "http://127.0.0.1:8080";
    vi.clearAllMocks();
    mocks.getJob.mockResolvedValue({
      stage: "publish", actions: [{ id: "action-1", title: "Post", state: "planned" }],
    });
    mocks.finalizeCommandReceipt.mockResolvedValue({ duplicate: false, receipt: { id: "receipt-1" } });
  });

  it("passes the live operation fence into atomic receipt finalization", async () => {
    const response = await POST(request(true));
    expect(response.status).toBe(200);
    expect(mocks.finalizeCommandReceipt).toHaveBeenCalledWith(
      "command-1", expect.objectContaining({ operationId, outcome: "applied" }), "owner-1",
      expect.objectContaining({ operationId, epoch: 2, workspaceId: "workspace-1", brandId: "brand-1" }),
    );
  });

  it("rejects a command receipt without a durable-operation fence", async () => {
    const response = await POST(request(false));
    expect(response.status).toBe(400);
    expect(mocks.finalizeCommandReceipt).not.toHaveBeenCalled();
  });
});
