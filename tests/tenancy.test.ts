import { describe, expect, it } from "vitest";
import {
  assertResourceWorkspace,
  agentEngineUserId,
  currentTenant,
  requireWorkspaceRole,
  runWithTenant,
  tenantCollectionPath,
  tenantDocumentPath,
  type TenantContext,
} from "@/lib/tenancy";
import { firebasePrincipal } from "@/lib/authority";

const tenant: TenantContext = {
  workspaceId: "workspace-a",
  brandId: "brand-a",
  principal: firebasePrincipal({
    subjectId: "user-a", workspaceRole: "owner", authenticationId: "session-a",
  }),
};

describe("workspace isolation", () => {
  it("places every durable collection below the workspace boundary", () => {
    expect(tenantCollectionPath(tenant, "jobs")).toBe("workspaces/workspace-a/jobs");
    expect(tenantDocumentPath(tenant, "jobs", "job-1")).toBe(
      "workspaces/workspace-a/jobs/job-1",
    );
  });

  it("rejects resources belonging to another workspace", () => {
    expect(() => assertResourceWorkspace(tenant, { workspaceId: "workspace-b" })).toThrow(
      /workspace access denied/,
    );
  });

  it("accepts resources belonging to the active workspace", () => {
    expect(() => assertResourceWorkspace(tenant, { workspaceId: "workspace-a" })).not.toThrow();
  });

  it("keeps concurrent request contexts isolated", async () => {
    const other: TenantContext = {
      workspaceId: "workspace-b",
      brandId: "brand-b",
      principal: firebasePrincipal({
        subjectId: "user-b", workspaceRole: "member", authenticationId: "session-b",
      }),
    };
    const [first, second] = await Promise.all([
      runWithTenant(tenant, async () => {
        await Promise.resolve();
        return currentTenant().workspaceId;
      }),
      runWithTenant(other, async () => {
        await Promise.resolve();
        return currentTenant().workspaceId;
      }),
    ]);
    expect([first, second]).toEqual(["workspace-a", "workspace-b"]);
  });

  it("namespaces managed Agent Engine users by workspace, user, and job", () => {
    expect(agentEngineUserId(tenant, "job-1")).toBe("workspace-a:user-a:job-1");
  });

  it("rejects unrecognized membership roles", () => {
    expect(requireWorkspaceRole("admin")).toBe("admin");
    expect(() => requireWorkspaceRole("superuser")).toThrow(/invalid workspace role/);
  });
});
