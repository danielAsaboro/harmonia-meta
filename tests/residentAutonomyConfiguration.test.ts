import { describe, expect, it } from "vitest";
import { promoteConfiguration, rollbackConfiguration } from "@/lib/residentAutonomy/configuration";

const current = { revisionId: "rev-1", workspaceId: "w", brandId: "b", category: "retry_backoff_seconds", value: 30 };
describe("resident autonomy configuration revisions", () => {
  it("creates a versioned reversible revision using compare-and-set", () => {
    const result = promoteConfiguration(current, { expectedRevisionId: "rev-1", revisionId: "rev-2", candidateValue: 45, evidenceRefs: ["obs-1", "obs-2"], confidence: 0.9, traceId: "a".repeat(32), at: "2026-08-27T08:00:00.000Z" });
    expect(result.config).toEqual({ ...current, revisionId: "rev-2", value: 45 });
    expect(result.revision).toMatchObject({ id: "rev-2", previousValue: 30, newValue: 45, rollbackRevisionId: "rev-1", state: "applied" });
    expect(() => promoteConfiguration(current, { expectedRevisionId: "stale", revisionId: "rev-2", candidateValue: 45, evidenceRefs: ["obs-1"], confidence: 0.9, traceId: "a".repeat(32), at: "2026-08-27T08:00:00.000Z" })).toThrow(/conflict/i);
  });
  it("restores the previous value and records the guardrail failure", () => {
    const applied = { revisionId: "rev-2", workspaceId: "w", brandId: "b", category: "retry_backoff_seconds", value: 45 };
    const result = rollbackConfiguration(applied, { appliedRevisionId: "rev-2", rollbackRevisionId: "rev-1", rollbackValue: 30, recordId: "rollback-1", reason: "verified failure rate exceeded baseline", evidenceRefs: ["guardrail-1"], traceId: "b".repeat(32), at: "2026-08-28T08:00:00.000Z" });
    expect(result.config.value).toBe(30); expect(result.revision).toMatchObject({ state: "rolled_back", rollbackReason: "verified failure rate exceeded baseline" });
  });
});
