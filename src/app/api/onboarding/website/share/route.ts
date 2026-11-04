import { operatorTenantHandler } from "@/lib/auth";
import { requireContentOperator } from "@/lib/authority";
import { revokeBriefShares, shareBrandBrief } from "@/lib/briefShares";
import { currentTenant } from "@/lib/tenancy";

// A read-only, no-login link to the current brand brief. Creating one replaces the old link.
async function post(_req: Request) {
  requireContentOperator(currentTenant());
  try {
    const share = await shareBrandBrief();
    return Response.json({ path: `/b/${share.token}`, createdAt: share.createdAt }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
}

async function del(_req: Request) {
  requireContentOperator(currentTenant());
  return Response.json({ revoked: await revokeBriefShares() });
}

export const POST = operatorTenantHandler(post);
export const DELETE = operatorTenantHandler(del);
