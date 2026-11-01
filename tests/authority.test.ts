import { describe, expect, it } from "vitest";

import {
  AuthorityError,
  firebasePrincipal,
  oauthCallbackPrincipal,
  requireContentOperator,
  requireOAuthCallback,
  requireService,
  requireWorkspaceAdministrator,
  servicePrincipal,
  telegramPrincipal,
} from "@/lib/authority";
import type { TenantContext } from "@/lib/tenancy";

function context(principal: TenantContext["principal"]): TenantContext {
  return {
    workspaceId: "workspace-1",
    brandId: "brand-1",
    principal,
  };
}

describe("authenticated principal capabilities", () => {
  it("never treats the worker as a content operator", () => {
    expect(() => requireContentOperator(context(servicePrincipal("request-1"))))
      .toThrowError(new AuthorityError(
        "human content operator required",
        403,
        "content_operator_required",
      ));
  });

  it("allows Firebase members and verified Telegram users to decide content", () => {
    expect(requireContentOperator(context(firebasePrincipal({
      subjectId: "user-1",
      workspaceRole: "member",
      authenticationId: "session-1",
    }))).kind).toBe("firebase_user");
    expect(requireContentOperator(context(telegramPrincipal({
      subjectId: "telegram_42",
      authenticationId: "update-1",
      chatIdDigest: "a".repeat(64),
      callbackQueryIdDigest: "b".repeat(64),
    }))).kind).toBe("telegram_user");
  });

  it("requires a Firebase owner or admin for credential mutation", () => {
    expect(() => requireWorkspaceAdministrator(context(firebasePrincipal({
      subjectId: "user-1",
      workspaceRole: "member",
      authenticationId: "session-1",
    })))).toThrowError(new AuthorityError(
      "workspace administrator required",
      403,
      "workspace_administrator_required",
    ));
    expect(requireWorkspaceAdministrator(context(firebasePrincipal({
      subjectId: "user-2",
      workspaceRole: "admin",
      authenticationId: "session-2",
    }))).workspaceRole).toBe("admin");
  });

  it("allows only the internal worker through the service capability", () => {
    expect(requireService(context(servicePrincipal("request-1"))).subjectId)
      .toBe("harmonia-worker");
    expect(() => requireService(context(firebasePrincipal({
      subjectId: "user-1",
      workspaceRole: "owner",
      authenticationId: "session-1",
    })))).toThrowError(new AuthorityError(
      "internal service required",
      403,
      "service_required",
    ));
  });

  it("binds OAuth callbacks to one platform", () => {
    const oauth = context(oauthCallbackPrincipal({
      stateId: "state-1",
      platform: "x",
    }));
    expect(requireOAuthCallback(oauth, "x").platform).toBe("x");
    expect(() => requireOAuthCallback(oauth, "google-calendar"))
      .toThrowError(new AuthorityError(
        "OAuth callback platform mismatch",
        403,
        "oauth_callback_platform_mismatch",
      ));
  });
});
