import { createHash, randomBytes } from "node:crypto";
import { db } from "./firestore";
import type { TenantContext } from "./tenancy";

// Workspace tokens for MCP clients. Only the SHA-256 of a token is stored; the
// token itself is shown once, when it is minted. A token reaches only the
// routes in AGENT_TOKEN_ROUTES, and its principal can never approve effects.

const COLLECTION = "agent_tokens";
export const AGENT_TOKEN_PREFIX = "hmn_";

/** Routes an MCP client may call: ask, read campaigns, read proof. */
export const AGENT_TOKEN_ROUTES: ReadonlyArray<{ method: string; pattern: RegExp }> = [
  { method: "POST", pattern: /^\/api\/chat$/ },
  { method: "POST", pattern: /^\/api\/a2a$/ },
  { method: "GET", pattern: /^\/api\/jobs$/ },
  { method: "GET", pattern: /^\/api\/jobs\/[A-Za-z0-9_-]{1,128}$/ },
];

export interface AgentTokenRecord {
  id: string;
  label: string;
  workspaceId: string;
  brandId: string;
  ownerSubjectId: string;
  createdAt: string;
  revokedAt?: string;
  lastUsedAt?: string;
}

export function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function agentTokenRouteAllowed(method: string, pathname: string): boolean {
  return AGENT_TOKEN_ROUTES.some((route) => route.method === method && route.pattern.test(pathname));
}

export async function mintAgentToken(tenant: TenantContext, label: string): Promise<{ token: string; record: AgentTokenRecord }> {
  const token = `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const record: AgentTokenRecord = {
    id: tokenDigest(token).slice(0, 16),
    label: label.slice(0, 80),
    workspaceId: tenant.workspaceId,
    brandId: tenant.brandId,
    ownerSubjectId: tenant.principal.subjectId,
    createdAt: new Date().toISOString(),
  };
  await db().collection(COLLECTION).doc(tokenDigest(token)).create(record);
  return { token, record };
}

export async function resolveAgentToken(token: string): Promise<AgentTokenRecord | null> {
  if (!token.startsWith(AGENT_TOKEN_PREFIX)) return null;
  const ref = db().collection(COLLECTION).doc(tokenDigest(token));
  const snap = await ref.get();
  if (!snap.exists) return null;
  const record = snap.data() as AgentTokenRecord;
  if (record.revokedAt) return null;
  await ref.update({ lastUsedAt: new Date().toISOString() }).catch(() => undefined);
  return record;
}

export async function listAgentTokens(workspaceId: string): Promise<AgentTokenRecord[]> {
  const snaps = await db().collection(COLLECTION).where("workspaceId", "==", workspaceId).get();
  return snaps.docs.map((doc) => doc.data() as AgentTokenRecord).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function revokeAgentToken(workspaceId: string, id: string): Promise<boolean> {
  const snaps = await db().collection(COLLECTION).where("workspaceId", "==", workspaceId).where("id", "==", id).get();
  await Promise.all(snaps.docs.map((doc) => doc.ref.update({ revokedAt: new Date().toISOString() })));
  return !snaps.empty;
}
