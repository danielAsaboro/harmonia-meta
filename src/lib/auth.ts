import { createHash } from "node:crypto";
import { adminAuth } from "./firebaseAdmin";
import { db } from "./firestore";
import { currentTenant, requireWorkspaceRole, runWithTenant, type TenantContext } from "./tenancy";
import { AuthorityError, firebasePrincipal, requireWorkspaceAdministrator } from "./authority";
import { withTraceContext } from "./telemetry";

export const SESSION_COOKIE = "harmonia_session";
// Firebase session cookies permit a maximum lifetime of 14 days. The client
// silently renews this cookie from its persisted Firebase identity for up to
// 30 days after the operator's last interactive Google sign-in.
const SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const DEV_SESSION_VALUE = "dev-local";
const DEV_USER_ID = "dev-local-user";

interface UserDoc {
  defaultWorkspaceId: string;
  defaultBrandId: string;
}

function cookieValue(req: Request, name: string): string | null {
  const cookie = req.headers.get("cookie") ?? "";
  for (const part of cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function stableId(prefix: string, value: string): string {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

export function isDevAuthBypassEnabled(): boolean {
  const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST ?? "";
  const usingLocalEmulator = /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(emulatorHost);
  return process.env.HARMONIA_DEV_AUTH_BYPASS === "1"
    && (process.env.NODE_ENV !== "production" || usingLocalEmulator);
}

function sessionCookie(value: string): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Max-Age=${SESSION_TTL_MS / 1000}; Path=/; HttpOnly${secure}; SameSite=Lax`;
}

async function ensurePersonalWorkspace(uid: string, email?: string): Promise<UserDoc> {
  const userRef = db().collection("users").doc(uid);
  const existing = await userRef.get();
  if (existing.exists) return existing.data() as UserDoc;

  const workspaceId = stableId("ws", uid);
  const brandId = stableId("brand", `${uid}:default`);
  const now = new Date().toISOString();
  const user: UserDoc = { defaultWorkspaceId: workspaceId, defaultBrandId: brandId };
  await db().runTransaction(async (tx) => {
    const fresh = await tx.get(userRef);
    if (fresh.exists) return;
    const workspaceRef = db().collection("workspaces").doc(workspaceId);
    tx.create(workspaceRef, {
      id: workspaceId,
      name: email ? `${email.split("@")[0]}'s workspace` : "My workspace",
      ownerUserId: uid,
      defaultBrandId: brandId,
      budget: {
        estimatedUsd: "0.00",
        observedUsd: "0.00",
        reservedUsd: "0.00",
        limitUsd: process.env.DEFAULT_WORKSPACE_BUDGET_USD ?? "100.00",
        approvalThresholdUsd: process.env.DEFAULT_JOB_APPROVAL_THRESHOLD_USD ?? "0.25",
      },
      createdAt: now,
      updatedAt: now,
    });
    tx.create(workspaceRef.collection("members").doc(uid), {
      userId: uid,
      role: "owner",
      createdAt: now,
    });
    tx.create(workspaceRef.collection("brands").doc(brandId), {
      id: brandId,
      name: "Default brand",
      createdAt: now,
      updatedAt: now,
    });
    tx.create(userRef, user);
  });
  const resolved = await userRef.get();
  return resolved.data() as UserDoc;
}

export async function requireTenantContext(req: Request): Promise<TenantContext> {
  const session = cookieValue(req, SESSION_COOKIE);
  if (!session) throw new AuthError("authentication required", 401);
  if (isDevAuthBypassEnabled() && session === DEV_SESSION_VALUE) {
    const user = await ensurePersonalWorkspace(DEV_USER_ID, "local@harmonia.dev");
    return {
      workspaceId: user.defaultWorkspaceId,
      brandId: user.defaultBrandId,
      principal: firebasePrincipal({
        subjectId: DEV_USER_ID,
        workspaceRole: "owner",
        authenticationId: "dev_local_session",
      }),
    };
  }
  let decoded;
  try {
    decoded = await adminAuth().verifySessionCookie(session, true);
  } catch {
    throw new AuthError("invalid session", 401);
  }
  if (decoded.firebase?.sign_in_provider !== "google.com") {
    throw new AuthError("Google sign-in required", 403);
  }
  const user = await ensurePersonalWorkspace(decoded.uid, decoded.email);
  const member = await db()
    .collection("workspaces")
    .doc(user.defaultWorkspaceId)
    .collection("members")
    .doc(decoded.uid)
    .get();
  if (!member.exists) throw new AuthError("workspace membership required", 403);
  let role;
  try {
    role = requireWorkspaceRole(member.get("role"));
  } catch {
    throw new AuthError("invalid workspace membership", 403);
  }
  if (role === "service") throw new AuthError("invalid workspace membership", 403);
  return {
    workspaceId: user.defaultWorkspaceId,
    brandId: user.defaultBrandId,
    principal: firebasePrincipal({
      subjectId: decoded.uid,
      workspaceRole: role,
      authenticationId: `firebase_${createHash("sha256").update(session).digest("hex").slice(0, 24)}`,
    }),
  };
}

export async function withTenant<T>(req: Request, work: (tenant: TenantContext) => T): Promise<T> {
  const tenant = await requireTenantContext(req);
  return withTraceContext(req.headers, () => runWithTenant(tenant, () => work(tenant)));
}

export class AuthError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message);
  }
}

export function authErrorResponse(error: unknown): Response {
  if (error instanceof AuthError) return Response.json({ error: error.message }, { status: error.status });
  if (error instanceof AuthorityError) {
    return Response.json({ error: error.message, code: error.code }, { status: error.status });
  }
  throw error;
}

export function tenantHandler<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<Response>,
): (req: Request, ...args: Args) => Promise<Response> {
  return async (req, ...args) => {
    try {
      return await withTenant(req, () => handler(req, ...args));
    } catch (error) {
      return authErrorResponse(error);
    }
  };
}

/** Browser-session-only boundary for workspace control-plane mutations. */
export function administratorTenantHandler<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<Response>,
): (req: Request, ...args: Args) => Promise<Response> {
  return operatorTenantHandler(async (req, ...args) => {
    requireWorkspaceAdministrator(currentTenant());
    return handler(req, ...args);
  });
}

/** Browser-session-only tenant boundary for explicit operator effects. */
export function operatorTenantHandler<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<Response>,
): (req: Request, ...args: Args) => Promise<Response> {
  return async (req, ...args) => {
    try {
      return await withTenant(req, () => handler(req, ...args));
    } catch (error) {
      return authErrorResponse(error);
    }
  };
}

export async function createSessionCookie(idToken: string): Promise<string> {
  const decoded = await adminAuth().verifyIdToken(idToken, true);
  if (decoded.firebase?.sign_in_provider !== "google.com") {
    throw new AuthError("Google sign-in required", 403);
  }
  const value = await adminAuth().createSessionCookie(idToken, { expiresIn: SESSION_TTL_MS });
  return sessionCookie(value);
}

export function createDevSessionCookie(): string {
  if (!isDevAuthBypassEnabled()) throw new AuthError("development authentication bypass is disabled", 403);
  return sessionCookie(DEV_SESSION_VALUE);
}

export function clearSessionCookie(): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly${secure}; SameSite=Lax`;
}
