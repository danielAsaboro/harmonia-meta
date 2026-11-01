import { beforeEach, describe, expect, it, vi } from "vitest";

const pending = vi.hoisted(() => ({
  claimPendingOperationDecision: vi.fn(), decidePendingOperation: vi.fn(), failPendingOperationDecision: vi.fn(),
  finalizePendingOperationDecision: vi.fn(), getPendingOperation: vi.fn(),
}));
const production = vi.hoisted(() => ({ approveProductionPlan: vi.fn(), rejectProductionPlan: vi.fn(), getProductionPlan: vi.fn() }));
vi.mock("@/lib/pendingOperations", () => pending);
vi.mock("@/lib/productionPlanStore", () => production);
vi.mock("@/lib/auth", () => ({ operatorTenantHandler: (handler: unknown) => handler }));
vi.mock("@/lib/decisions", () => ({ resolveDecision: vi.fn() }));
vi.mock("@/lib/firestore", () => ({ decideStrategy: vi.fn() }));
vi.mock("@/lib/stageOutboxDispatcher", () => ({ dispatchStageOutboxRecord: vi.fn() }));

import { POST } from "@/app/api/chat/operations/[id]/decision/route";

describe("chat production confirmation decision", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const operation = {
      id: "operation-1", handler: "decide_production_plan",
      arguments: { jobId: "job-1", actionId: "plan-1", payloadDigest: "a".repeat(64) },
    };
    pending.getPendingOperation.mockResolvedValue(operation);
    pending.claimPendingOperationDecision.mockResolvedValue(operation);
    pending.finalizePendingOperationDecision.mockResolvedValue({ ...operation, state: "approved" });
    production.getProductionPlan.mockResolvedValue({ id: "plan-1", state: "sealed", currentPlanDigest: "a".repeat(64) });
    production.approveProductionPlan.mockResolvedValue({ id: "plan-1:mandate:v1" });
  });

  it("grants only the digest-bound production mandate with a bounded expiry", async () => {
    const before = Date.now();
    const response = await POST(new Request("http://localhost/api/chat/operations/operation-1/decision", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approved" }),
    }), { params: Promise.resolve({ id: "operation-1" }) });
    expect(response.status).toBe(200);
    expect(production.approveProductionPlan).toHaveBeenCalledWith("plan-1", {
      planDigest: "a".repeat(64),
      expiresAt: expect.any(String),
    });
    const expiresAt = Date.parse(production.approveProductionPlan.mock.calls[0][1].expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 23 * 60 * 60 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 24 * 60 * 60 * 1000 + 1000);
    expect(pending.finalizePendingOperationDecision).toHaveBeenCalledWith("operation-1", "approved");
  });

  it("reconciles a committed matching mandate after a confirmation crash", async () => {
    production.getProductionPlan.mockResolvedValue({ id: "plan-1", state: "approved", currentPlanDigest: "a".repeat(64) });
    const response = await POST(new Request("http://localhost/api/chat/operations/operation-1/decision", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision: "approved" }),
    }), { params: Promise.resolve({ id: "operation-1" }) });
    expect(response.status).toBe(200);
    expect(production.approveProductionPlan).not.toHaveBeenCalled();
    expect(pending.finalizePendingOperationDecision).toHaveBeenCalledWith("operation-1", "approved");
  });
});
