import { createHash } from "node:crypto";

import type { TenantContext } from "./tenancy";

export type FirebaseWorkspaceRole = "owner" | "admin" | "member";

export type Principal =
  | {
      kind: "firebase_user";
      subjectId: string;
      workspaceRole: FirebaseWorkspaceRole;
      authenticationId: string;
    }
  | {
      kind: "telegram_user";
      subjectId: string;
      workspaceRole: "member";
      authenticationId: string;
      chatIdDigest: string;
      callbackQueryIdDigest: string;
    }
  | {
      kind: "service";
      subjectId: "harmonia-worker";
      workspaceRole: "service";
      authenticationId: string;
    }
  | {
      kind: "oauth_callback";
      subjectId: string;
      workspaceRole: "service";
      authenticationId: string;
      platform: string;
    };

export class AuthorityError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403,
    readonly code: string,
  ) {
    super(message);
  }
}

export function firebasePrincipal(input: {
  subjectId: string;
  workspaceRole: FirebaseWorkspaceRole;
  authenticationId: string;
}): Extract<Principal, { kind: "firebase_user" }> {
  return { kind: "firebase_user", ...input };
}

export function telegramPrincipal(input: {
  subjectId: string;
  authenticationId: string;
  chatIdDigest: string;
  callbackQueryIdDigest: string;
}): Extract<Principal, { kind: "telegram_user" }> {
  return { kind: "telegram_user", workspaceRole: "member", ...input };
}

export function servicePrincipal(authenticationId: string): Extract<Principal, { kind: "service" }> {
  return {
    kind: "service",
    subjectId: "harmonia-worker",
    workspaceRole: "service",
    authenticationId,
  };
}

export function oauthCallbackPrincipal(input: {
  stateId: string;
  platform: string;
}): Extract<Principal, { kind: "oauth_callback" }> {
  const digest = createHash("sha256").update(input.stateId).digest("hex").slice(0, 24);
  return {
    kind: "oauth_callback",
    subjectId: `oauth_${digest}`,
    workspaceRole: "service",
    authenticationId: `oauth_state_${digest}`,
    platform: input.platform,
  };
}

export function requireContentOperator(
  context: TenantContext,
): Extract<Principal, { kind: "firebase_user" | "telegram_user" }> {
  const { principal } = context;
  if (principal.kind !== "firebase_user" && principal.kind !== "telegram_user") {
    throw new AuthorityError(
      "human content operator required",
      403,
      "content_operator_required",
    );
  }
  return principal;
}

export function requireWorkspaceAdministrator(
  context: TenantContext,
): Extract<Principal, { kind: "firebase_user" }> {
  const { principal } = context;
  if (
    principal.kind !== "firebase_user"
    || (principal.workspaceRole !== "owner" && principal.workspaceRole !== "admin")
  ) {
    throw new AuthorityError(
      "workspace administrator required",
      403,
      "workspace_administrator_required",
    );
  }
  return principal;
}

export function requireProductionOperator(
  context: TenantContext,
): Extract<Principal, { kind: "firebase_user" | "telegram_user" }> {
  const { principal } = context;
  if (principal.kind === "telegram_user") return principal;
  if (
    principal.kind === "firebase_user"
    && (principal.workspaceRole === "owner" || principal.workspaceRole === "admin")
  ) return principal;
  throw new AuthorityError(
    "workspace administrator or allow-listed Telegram operator required",
    403,
    "production_operator_required",
  );
}

export function requireService(
  context: TenantContext,
): Extract<Principal, { kind: "service" }> {
  if (context.principal.kind !== "service") {
    throw new AuthorityError("internal service required", 403, "service_required");
  }
  return context.principal;
}

export function requireOAuthCallback(
  context: TenantContext,
  platform: string,
): Extract<Principal, { kind: "oauth_callback" }> {
  const { principal } = context;
  if (principal.kind !== "oauth_callback") {
    throw new AuthorityError("OAuth callback required", 403, "oauth_callback_required");
  }
  if (principal.platform !== platform) {
    throw new AuthorityError(
      "OAuth callback platform mismatch",
      403,
      "oauth_callback_platform_mismatch",
    );
  }
  return principal;
}
