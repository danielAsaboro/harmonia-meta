import { describe, expect, it } from "vitest";
import { summarizeActivity } from "@/components/monitoring/ActivityMetrics";
import type { AgentActivity } from "@/lib/observability/schema";

function record(overrides: Partial<AgentActivity> = {}): AgentActivity {
  return {
    id: "activity-1", schemaVersion: 1, workspaceId: "workspace-1", brandId: "brand-1",
    jobId: "job-1", invocationId: "op-1:ryan_strategist", operationId: "op-1",
    occurredAt: "2026-08-28T10:00:00.000Z", signalType: "metric",
    eventName: "agent.measurement", severity: "info", outcome: "success",
    agent: "ryan_strategist", stage: "strategize", workflow: "harmonia.agent",
    model: "gemini-3.5-flash", tool: null, traceId: "a".repeat(32), spanId: "b".repeat(16),
    parentSpanId: null, durationMs: 100, inputTokens: 40, outputTokens: 10,
    inferenceCalls: 1, toolCalls: 0, errorCategory: null, errorType: null,
    backend: "google_cloud", ...overrides,
  };
}

describe("activity summaries", () => {
  it("groups invocations, latency, tokens, and errors per agent", () => {
    const summary = summarizeActivity([
      record(),
      record({ id: "activity-2", outcome: "error", severity: "error", durationMs: 300,
        inputTokens: 80, outputTokens: 20, errorCategory: "dependency", errorType: "ProviderError" }),
    ]);
    expect(summary.totalInvocations).toBe(2);
    expect(summary.successRate).toBe(0.5);
    expect(summary.agents[0]).toMatchObject({
      agent: "ryan_strategist", invocations: 2, inputTokens: 120,
      outputTokens: 30, p50Ms: 300, p95Ms: 300,
    });
  });

  it("does not double count log and trace projections as metrics", () => {
    expect(summarizeActivity([record({ signalType: "trace" })]).totalInvocations).toBe(0);
  });
});
