import { describe, expect, it } from "vitest";
import { agentTokenPrincipal, requireContentOperator, requireSourceRequester, requireWorkspaceAdministrator } from "@/lib/authority";
import { agentTokenRouteAllowed, tokenDigest } from "@/lib/agentTokens";
import { requireTenantContext } from "@/lib/auth";
import { sourceRightsAuthorization } from "@/lib/sourceRights";

const tenant = {
  workspaceId: "w1", brandId: "b1",
  principal: agentTokenPrincipal({ ownerSubjectId: "owner-uid", tokenId: "tok123" }),
};

describe("MCP agent tokens", () => {
  it("reach only ask, list and read routes", () => {
    expect(agentTokenRouteAllowed("POST", "/api/chat")).toBe(true);
    expect(agentTokenRouteAllowed("GET", "/api/jobs")).toBe(true);
    expect(agentTokenRouteAllowed("GET", "/api/jobs/job-1")).toBe(true);
    for (const [method, path] of [
      ["POST", "/api/jobs/job-1/actions/a1/decision"], ["POST", "/api/proposals/decide"], ["POST", "/api/jobs"],
      ["GET", "/api/jobs/job-1/assets/a1"], ["POST", "/api/settings/agent-tokens"], ["POST", "/api/chat/operations"],
    ]) expect(agentTokenRouteAllowed(method, path), `${method} ${path}`).toBe(false);
  });

  it("are refused before any lookup on a route outside the allow list", async () => {
    const req = new Request("http://localhost/api/proposals/decide", { method: "POST", headers: { authorization: "Bearer hmn_abc" } });
    await expect(requireTenantContext(req)).rejects.toMatchObject({ status: 403 });
  });

  it("can attest source rights for the operator but never approve or administer", () => {
    expect(sourceRightsAuthorization(tenant, "web", "2026-11-04T15:00:00.000Z")).toMatchObject({
      attestedBySubjectId: "owner-uid", authenticationId: "agent_token_tok123", channel: "mcp",
    });
    expect(requireSourceRequester(tenant).kind).toBe("agent_token");
    expect(() => requireContentOperator(tenant)).toThrow("human content operator required");
    expect(() => requireWorkspaceAdministrator(tenant)).toThrow("workspace administrator required");
  });

  it("are stored only as a digest", () => {
    expect(tokenDigest("hmn_example")).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenDigest("hmn_example")).not.toContain("hmn_");
  });
});
