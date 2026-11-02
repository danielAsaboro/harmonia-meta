import { describe, expect, it } from "vitest";
import { agentActivitySchema, observabilityQuerySchema } from "@/lib/observability/schema";

const validActivity = {
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
  workflow: "harmonia.agent",
  model: "gemini-3.5-flash",
  traceId: "a".repeat(32),
  spanId: "b".repeat(16),
  durationMs: 120,
  inputTokens: 40,
  outputTokens: 20,
  inferenceCalls: 1,
  toolCalls: 0,
  backend: "google_cloud",
} as const;

describe("agent activity schema", () => {
  it("accepts the strict Python wire contract", () => {
    expect(agentActivitySchema.parse(validActivity)).toEqual(validActivity);
  });

  it("rejects content-bearing and unknown activity fields", () => {
    expect(() => agentActivitySchema.parse({ ...validActivity, prompt: "private" })).toThrow();
  });

  it("rejects error records without a safe category", () => {
    expect(() => agentActivitySchema.parse({ ...validActivity, outcome: "error", severity: "error" })).toThrow();
  });

  it("bounds query filters and page size", () => {
    expect(observabilityQuerySchema.parse({ limit: 100, types: ["log", "trace"] }).limit).toBe(100);
    expect(() => observabilityQuerySchema.parse({ limit: 101 })).toThrow();
    expect(() => observabilityQuerySchema.parse({ q: "x".repeat(201) })).toThrow();
  });
});
