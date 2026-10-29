import { internalTenantHandler } from "@/lib/internalAuth";
import { listConnectionMetadata } from "@/lib/firestore";
import { PLATFORMS } from "@/lib/platforms";

async function get() {
  const stored = await listConnectionMetadata();
  const byPlatform = new Map(stored.map((item) => [item.platform, item]));
  return Response.json({
    connections: PLATFORMS.map((platform) => {
      const connection = byPlatform.get(platform.id);
      return {
        id: platform.id,
        label: platform.label,
        connected: Boolean(connection && (connection.health ?? "active") === "active"),
        health: connection?.health ?? (connection ? "active" : "not_connected"),
        capabilities: platform.capabilities,
        productAvailability: platform.productAvailability,
      };
    }),
  });
}

export const GET = internalTenantHandler(get);
