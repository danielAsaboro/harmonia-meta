import { getConfig } from "./config";
import { runWithTenant, type TenantContext } from "./tenancy";
import { randomUUID } from "node:crypto";
import { servicePrincipal } from "./authority";

export function isInternalAuthorized(req: Request): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = `Bearer ${getConfig().INTERNAL_API_TOKEN}`;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export function unauthorized(): Response {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export function internalTenantContext(req: Request): TenantContext {
  const workspaceId = req.headers.get("x-workspace-id") ?? "";
  const brandId = req.headers.get("x-brand-id") ?? "";
  if (!workspaceId || !brandId) throw new Error("internal tenant headers required");
  const authenticationId = `service_${randomUUID().replaceAll("-", "")}`;
  return { workspaceId, brandId, principal: servicePrincipal(authenticationId) };
}

export function withInternalTenant<T>(req: Request, work: () => T): T {
  return runWithTenant(internalTenantContext(req), work);
}

export function internalTenantHandler<Args extends unknown[]>(
  handler: (req: Request, ...args: Args) => Promise<Response>,
): (req: Request, ...args: Args) => Promise<Response> {
  return async (req, ...args) => {
    if (!isInternalAuthorized(req)) return unauthorized();
    try {
      return await withInternalTenant(req, () => handler(req, ...args));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 400 });
    }
  };
}
