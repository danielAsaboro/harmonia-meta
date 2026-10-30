import { z } from "zod";
import { deleteConnection, getConnection, saveConnection } from "@/lib/firestore";
import { administratorTenantHandler } from "@/lib/auth";
import { getPlatform, revokeAccess } from "@/lib/oauth";
import { disconnectConnection } from "@/lib/connectionDisconnect";

const manualTokenSchema = z.object({
  accessToken: z.string().min(8),
  refreshToken: z.string().optional(),
  expiresInSeconds: z.number().int().positive().optional(),
  handle: z.string().max(120).optional(),
});

/** Advanced fallback: register an existing access token for a platform. */
async function put(
  req: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  if (!getPlatform(platform)) {
    return Response.json({ error: "unknown platform" }, { status: 404 });
  }
  if (platform === "google-calendar") {
    return Response.json({ error: "Google Calendar requires scoped OAuth consent" }, { status: 400 });
  }
  const body = await req.json().catch(() => null);
  const parsed = manualTokenSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "invalid token payload" }, { status: 400 });
  }
  await saveConnection({
    platform,
    mode: "manual",
    handle: parsed.data.handle,
    scopes: undefined,
    accessToken: parsed.data.accessToken,
    refreshToken: parsed.data.refreshToken,
    expiresAt: parsed.data.expiresInSeconds
      ? new Date(Date.now() + parsed.data.expiresInSeconds * 1000).toISOString()
      : undefined,
    connectedAt: new Date().toISOString(),
  });
  return Response.json({ ok: true });
}

async function del(
  req: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  if (!getPlatform(platform)) {
    return Response.json({ error: "unknown platform" }, { status: 404 });
  }
  try {
    await disconnectConnection(platform, {
      get: getConnection,
      revoke: (connection) => revokeAccess(getPlatform(connection.platform)!, connection),
      remove: deleteConnection,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({
      error: error instanceof Error ? error.message : "connection revocation failed",
    }, { status: 502 });
  }
}

export const PUT = administratorTenantHandler(put);
export const DELETE = administratorTenantHandler(del);
