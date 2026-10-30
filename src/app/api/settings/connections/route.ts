import { getConnection } from "@/lib/firestore";
import { PLATFORMS, platformStatus } from "@/lib/platforms";
import { tenantHandler } from "@/lib/auth";
import { sanitizeSocialConnection } from "@/lib/publishing/connections";

/**
 * Live connection status per platform. A connection is "connected" only when
 * a stored OAuth/manual connection exists (with valid expiry) or the env
 * credentials are genuinely present. Tokens never leave the server.
 */
async function get(_req: Request) {
  return Response.json({
    connections: await Promise.all(
      PLATFORMS.map(async (def) => {
        const conn = await getConnection(def.id);
        const expired = conn?.expiresAt ? Date.parse(conn.expiresAt) < Date.now() : false;
        if (conn && !expired) {
          const safe = sanitizeSocialConnection(conn);
          return {
            id: def.id,
            label: def.label,
            capabilities: def.capabilities,
            productAvailability: def.productAvailability,
            note: def.note,
            docsUrl: def.docsUrl,
            status: "connected" as const,
            mode: safe.mode,
            handle: safe.handle,
            connectedAt: safe.connectedAt,
            expiresAt: safe.expiresAt,
            credentialRevision: safe.credentialRevision,
            health: safe.health,
            destinations: safe.destinations,
            defaultDestinationId: safe.defaultDestinationId,
            missingActive: [],
            missingRequired: [],
          };
        }
        return {
          id: def.id,
          label: def.label,
          capabilities: def.capabilities,
          productAvailability: def.productAvailability,
          note: def.note,
          docsUrl: def.docsUrl,
          ...platformStatus(def),
          ...(conn && expired
            ? { detail: "token expired — reconnect or refresh needed" }
            : {}),
        };
      }),
    ),
  });
}

export const GET = tenantHandler(get);
