import { beforeEach, describe, expect, it, vi } from "vitest";

const { runRecovery } = vi.hoisted(() => ({ runRecovery: vi.fn() }));
vi.mock("@/lib/recoveryStore", () => ({ runRecovery }));

import { POST } from "@/app/api/internal/recovery/route";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/internal/recovery", {
    method: "POST",
    headers: {
      authorization: "Bearer test-internal-token", "content-type": "application/json",
      "x-workspace-id": "workspace-1", "x-brand-id": "brand-1",
    },
    body: JSON.stringify(body),
  });
}

describe("recovery route", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.AGENT_SERVICE_URL = "http://127.0.0.1:8080";
    runRecovery.mockReset();
    runRecovery.mockResolvedValue({ actions: [], scannedCount: 0, estimatedCostUsd: "0.000000" });
  });

  it("accepts only bounded recovery requests", async () => {
    const body = { limit: 20, deadlineSeconds: 15, maxRetries: 3, maxCostUsd: "0.250000" };
    expect((await POST(request(body))).status).toBe(200);
    expect(runRecovery).toHaveBeenCalledWith(body);
    expect((await POST(request({ ...body, limit: 101 }))).status).toBe(400);
    expect((await POST(request({ ...body, deadlineSeconds: 61 }))).status).toBe(400);
  });
});
