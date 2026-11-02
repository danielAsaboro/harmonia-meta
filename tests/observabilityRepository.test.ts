import { describe, expect, it } from "vitest";
import {
  decodeActivityCursor,
  encodeActivityCursor,
  matchesActivityFilters,
  oldestLagSeconds,
} from "@/lib/observability/repository";
import type { AgentActivity } from "@/lib/observability/schema";

const item: AgentActivity = {
  id: "activity-1",
  schemaVersion: 1,
  workspaceId: "workspace-1",
  brandId: "brand-1",
  jobId: "job-1",
  invocationId: "op-1:nova_liaison",
  operationId: "op-1",
  occurredAt: "2026-08-28T10:00:00.000Z",
  signalType: "trace",
  eventName: "tool.execution",
  severity: "info",
  outcome: "success",
  agent: "nova_liaison",
  stage: "operator_ask",
  workflow: "harmonia.agent",
  model: null,
  tool: "get_job_status",
  traceId: "a".repeat(32),
  spanId: "b".repeat(16),
  parentSpanId: "c".repeat(16),
  durationMs: 8,
  inputTokens: 0,
  outputTokens: 0,
  inferenceCalls: 0,
  toolCalls: 0,
  errorCategory: null,
  errorType: null,
  backend: "google_cloud",
};

describe("agent activity repository helpers", () => {
  it("round-trips a structural opaque cursor and rejects malformed input", () => {
    const cursor = encodeActivityCursor({ occurredAt: item.occurredAt, id: item.id });
    expect(decodeActivityCursor(cursor)).toEqual({ occurredAt: item.occurredAt, id: item.id });
    expect(() => decodeActivityCursor("not-a-cursor")).toThrow("invalid observability cursor");
  });

  it("applies every safe filter without inspecting private content", () => {
    expect(matchesActivityFilters(item, {
      types: ["trace"], agent: "nova_liaison", stage: "operator_ask",
      outcome: "success", severity: "info", model: undefined,
      tool: "get_job_status", jobId: "job-1", traceId: "a".repeat(32),
      since: "2026-08-28T09:00:00.000Z", until: "2026-08-28T11:00:00.000Z",
      q: "job_status", limit: 25, cursor: undefined,
    })).toBe(true);
    expect(matchesActivityFilters(item, {
      types: ["log"], limit: 25,
    })).toBe(false);
  });

  it("reports bounded inbox and outbox lag without content inspection", () => {
    expect(oldestLagSeconds([
      "2026-08-28T09:59:40.000Z", "2026-08-28T09:59:50.000Z",
    ], "2026-08-28T10:00:00.000Z")).toBe(20);
    expect(oldestLagSeconds([], "2026-08-28T10:00:00.000Z")).toBe(0);
  });
});
