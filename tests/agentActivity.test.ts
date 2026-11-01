import { describe, expect, it } from "vitest";
import { agentActivitySchema } from "@/lib/contracts";

describe("structured agent activity", () => {
  it("accepts a safe handoff and a bounded retry", () => {
    expect(agentActivitySchema.parse({
      kind: "handoff", status: "succeeded", role: "nimi_analyst",
      fromRole: "nimi_analyst", toRole: "ryan_strategist",
      publicMessage: "Grounded analysis persisted for Ryan.",
    }).toRole).toBe("ryan_strategist");
    expect(agentActivitySchema.parse({
      kind: "retry", status: "retrying", role: "nova_liaison",
      code: "dependency_unavailable", category: "dependency",
      publicMessage: "The data source is temporarily unavailable.",
      retryable: true, attempt: 1, maxAttempts: 2,
    }).retryable).toBe(true);
    expect(agentActivitySchema.parse({
      kind: "failure", status: "failed", role: "noni_artifact_producer",
      code: "agent_output_repair_exhausted", category: "protocol",
      publicMessage: "Noni returned output that did not satisfy its contract.",
      retryable: false, attempt: 2, maxAttempts: 2,
    }).role).toBe("noni_artifact_producer");
  });

  it("rejects incomplete and content-bearing activity", () => {
    expect(() => agentActivitySchema.parse({
      kind: "handoff", status: "succeeded", role: "nimi_analyst",
      publicMessage: "Missing destination.",
    })).toThrow(/fromRole and toRole/);
    expect(() => agentActivitySchema.parse({
      kind: "tool_call", status: "succeeded", role: "nova_liaison",
      publicMessage: "Read complete.", prompt: "secret",
    })).toThrow();
  });
});
