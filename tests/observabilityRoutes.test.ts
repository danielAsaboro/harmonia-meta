import { beforeEach, describe, expect, it, vi } from "vitest";

const { writeAgentActivity } = vi.hoisted(() => ({ writeAgentActivity: vi.fn() }));
vi.mock("@/lib/observability/repository", async () => {
  const actual = await vi.importActual<typeof import("@/lib/observability/repository")>("@/lib/observability/repository");
  return { ...actual, writeAgentActivity };
});

import { POST } from "@/app/api/internal/observability/route";
import { parseObservabilityQuery } from "@/lib/observability/query";

const activity = {
  schemaVersion: 1,
  workspaceId: "workspace-1",
  brandId: "brand-1",
  jobId: "job-1",
  invocationId: "op-1:ryan_strategist",
  operationId: "op-1",
  occurredAt: "2026-08-28T10:00:00.000Z",
  signalType: "trace",
  eventName: "agent.invocation",
  severity: "info",
  outcome: "success",
  agent: "ryan_strategist",
  stage: "strategize",
  model: "gemini-3.5-flash",
  traceId: "a".repeat(32),
  spanId: "b".repeat(16),
  durationMs: 120,
  inputTokens: 40,
  outputTokens: 20,
  inferenceCalls: 1,
  toolCalls: 0,
  backend: "google_cloud",
};

describe("observability routes", () => {
  beforeEach(() => {
    process.env.INTERNAL_API_TOKEN = "test-internal-token";
    process.env.AGENT_SERVICE_URL = "http://127.0.0.1:8080";
    writeAgentActivity.mockReset();
    writeAgentActivity.mockResolvedValue({ id: "activity-1", duplicate: false });
  });

  it("rejects unauthenticated internal writes before parsing", async () => {
    const response = await POST(new Request("http://localhost/api/internal/observability", {
      method: "POST", body: JSON.stringify({ prompt: "private" }),
    }));
    expect(response.status).toBe(401);
    expect(writeAgentActivity).not.toHaveBeenCalled();
  });

  it("accepts a strict tenant-bound internal record", async () => {
    const response = await POST(new Request("http://localhost/api/internal/observability", {
      method: "POST",
      headers: {
        authorization: "Bearer test-internal-token",
        "x-workspace-id": "workspace-1",
        "x-brand-id": "brand-1",
      },
      body: JSON.stringify(activity),
    }));
    expect(response.status).toBe(201);
    expect(writeAgentActivity).toHaveBeenCalledWith(expect.objectContaining({ agent: "ryan_strategist" }));
  });

  it("parses repeated filters and rejects malformed cursors and dates", () => {
    const parsed = parseObservabilityQuery(new URL("http://localhost/api/observability?type=log&type=trace&agent=nova_liaison&limit=50"));
    expect(parsed).toMatchObject({ types: ["log", "trace"], agent: "nova_liaison", limit: 50 });
    expect(() => parseObservabilityQuery(new URL("http://localhost/api/observability?cursor=%25&limit=1"))).toThrow();
  });
});
