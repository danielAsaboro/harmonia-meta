import { requireContentOperator } from "./authority";
import { createHash } from "node:crypto";
import type { TenantContext } from "./tenancy";

export const RIGHTS_ATTESTATION_PHRASE = "I confirm I have rights to use this source";

export interface SourceRightsAuthorization {
  version: "source-rights-v1";
  sourceKind: "youtube" | "web" | "upload" | "pasted_text";
  attestedBySubjectId: string;
  authenticationId: string;
  channel: "dashboard" | "telegram";
  attestedAt: string;
}

export function sourceRightsAuthorizationId(authorization: SourceRightsAuthorization): string {
  return `rights_${createHash("sha256").update(JSON.stringify(authorization)).digest("hex").slice(0, 32)}`;
}

export function hasRightsAttestation(message: string): boolean {
  return message.toLocaleLowerCase().includes(RIGHTS_ATTESTATION_PHRASE.toLocaleLowerCase());
}

export function sourceRightsAuthorization(
  context: TenantContext,
  sourceKind: SourceRightsAuthorization["sourceKind"],
  now = new Date().toISOString(),
): SourceRightsAuthorization {
  const actor = requireContentOperator(context);
  return {
    version: "source-rights-v1",
    sourceKind,
    attestedBySubjectId: actor.subjectId,
    authenticationId: actor.authenticationId,
    channel: actor.kind === "telegram_user" ? "telegram" : "dashboard",
    attestedAt: now,
  };
}
