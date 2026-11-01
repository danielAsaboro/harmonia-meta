import { describe, expect, it } from "vitest";

import { projectAttentionItems, type AttentionSource } from "@/lib/operations/attention";

const scope = { workspaceId: "workspace-1", brandId: "brand-1", jobId: "job-1" };

function source(changes: Partial<AttentionSource> & Pick<AttentionSource, "kind" | "sourceId">): AttentionSource {
  return {
    ...scope,
    state: "open",
    title: "Operator decision required",
    reason: "A durable operation needs an authenticated decision.",
    createdAt: "2026-08-31T00:00:00.000Z",
    ...changes,
  } as AttentionSource;
}

describe("operator attention projection", () => {
  it("excludes resolved sources and orders safety-critical work first", () => {
    const items = projectAttentionItems([
      source({ kind: "missing_asset", sourceId: "asset-1" }),
      source({ kind: "approval", sourceId: "approval-1" }),
      source({ kind: "uncertain_effect", sourceId: "effect-1" }),
      source({ kind: "policy_block", sourceId: "policy-1" }),
      source({ kind: "credential_required", sourceId: "connection-1" }),
      source({ kind: "failed_stage", sourceId: "failure-1", state: "resolved" }),
    ]);

    expect(items.map((item) => item.kind)).toEqual([
      "uncertain_effect",
      "policy_block",
      "credential_required",
      "approval",
      "missing_asset",
    ]);
    expect(items.some((item) => item.sourceId === "failure-1")).toBe(false);
  });

  it("uses stable identities and authoritative resolution links", () => {
    const [approval, credential, effect] = projectAttentionItems([
      source({ kind: "approval", sourceId: "action-9" }),
      source({ kind: "uncertain_effect", sourceId: "operation-7" }),
      source({ kind: "credential_required", sourceId: "x" }),
    ]).sort((a, b) => a.kind.localeCompare(b.kind));

    expect(approval.id).toBe("attention:approval:action-9");
    expect(approval.actionHref).toBe("/dashboard/monitoring?tab=jobs&job=job-1&focus=approval&source=action-9");
    expect(credential.actionHref).toBe("/dashboard/settings?focus=connections&source=x");
    expect(effect.actionHref).toBe("/dashboard/monitoring?tab=agents&focus=operation-7");
  });

  it("deduplicates identical sources and rejects cross-tenant projections", () => {
    const duplicate = source({ kind: "budget_required", sourceId: "budget-1" });
    expect(projectAttentionItems([duplicate, duplicate])).toHaveLength(1);
    expect(() => projectAttentionItems([
      duplicate,
      { ...duplicate, sourceId: "budget-2", workspaceId: "workspace-2" },
    ])).toThrow("same tenant scope");
  });

  it("routes resident-agent attention without inventing a job aggregate", () => {
    const [budget, failure] = projectAttentionItems([
      source({ kind: "budget_required", sourceId: "resident-budget", jobId: undefined }),
      source({ kind: "failed_stage", sourceId: "resident-failure", jobId: undefined }),
    ]);
    expect(budget.actionHref).toContain("/dashboard/settings");
    expect(failure.actionHref).toContain("tab=autonomy");
  });
});
