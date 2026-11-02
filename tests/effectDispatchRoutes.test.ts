import { beforeEach, describe, expect, it, vi } from "vitest";

const { transitionCommandEffect } = vi.hoisted(() => ({ transitionCommandEffect: vi.fn() }));
vi.mock("@/lib/effectCommandStore", () => ({ transitionCommandEffect }));

import { POST } from "@/app/api/internal/effect-command/[id]/dispatch/route";

const operationId = "job:job-1:effect:command-1";
const base = {
  commandId: "command-1", jobId: "job-1", actionId: "action-1",
  actionType: "publish_x_post", idempotencyKey: "a".repeat(64),
  operationId, operationEpoch: 3, traceId: "b".repeat(32), claimToken: "owner-1",
};

function request(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/internal/effect-command/command-1/dispatch", {
    method: "POST",
    headers: {
      authorization: "Bearer test-internal-token", "content-type": "application/json",
      "x-workspace-id": "workspace-1", "x-brand-id": "brand-1",
      "x-harmonia-operation-id": operationId, "x-harmonia-operation-epoch": "3",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

describe("effect dispatch route", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.AGENT_SERVICE_URL = "http://127.0.0.1:8080";
    transitionCommandEffect.mockReset();
    transitionCommandEffect.mockResolvedValue({ id: "command-1", state: "dispatched" });
  });

  it("passes the exact body/header fence into the atomic transition", async () => {
    const response = await POST(request({ ...base, phase: "dispatched", attempt: 1 }), {
      params: Promise.resolve({ id: "command-1" }),
    });
    expect(response.status).toBe(200);
    expect(transitionCommandEffect).toHaveBeenCalledWith("command-1", {
      phase: "dispatched", claimToken: "owner-1", attempt: 1,
    }, expect.objectContaining({ operationId, epoch: 3, workspaceId: "workspace-1", brandId: "brand-1" }));
  });

  it("rejects stale epochs and path substitutions before mutation", async () => {
    const stale = await POST(request({ ...base, operationEpoch: 2, phase: "unknown", reason: "lost" }), {
      params: Promise.resolve({ id: "command-1" }),
    });
    expect(stale.status).toBe(409);
    const substituted = await POST(request({ ...base, commandId: "command-2", phase: "dispatched", attempt: 1 }), {
      params: Promise.resolve({ id: "command-1" }),
    });
    expect(substituted.status).toBe(409);
    expect(transitionCommandEffect).not.toHaveBeenCalled();
  });

  it("persists a provider-pending continuation instead of reporting unknown", async () => {
    const response = await POST(request({ ...base, phase: "provider_pending", providerOperationId: "operations/123", nextPollAt: "2099-01-01T00:00:00.000Z" }), {
      params: Promise.resolve({ id: "command-1" }),
    });
    expect(response.status).toBe(200);
    expect(transitionCommandEffect).toHaveBeenCalledWith("command-1", {
      phase: "provider_pending", claimToken: "owner-1", providerOperationId: "operations/123", nextPollAt: "2099-01-01T00:00:00.000Z",
    }, expect.objectContaining({ operationId, epoch: 3 }));
  });
});
