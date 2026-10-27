import type { ConnectionDoc } from "../firestore";
import type { PublishDestination } from "./contracts";

export interface SocialConnectionProjection {
  platform: string;
  mode: ConnectionDoc["mode"];
  handle?: string;
  accountId?: string;
  scopes: string[];
  expiresAt?: string;
  credentialRevision: number;
  health: "active" | "reconnect_required" | "revocation_pending";
  destinations: PublishDestination[];
  defaultDestinationId?: string;
  connectedAt: string;
}

export function sanitizeSocialConnection(connection: ConnectionDoc): SocialConnectionProjection {
  return {
    platform: connection.platform,
    mode: connection.mode,
    ...(connection.handle ? { handle: connection.handle } : {}),
    ...(connection.accountId ? { accountId: connection.accountId } : {}),
    scopes: connection.scopes?.split(/\s+/).filter(Boolean) ?? [],
    ...(connection.expiresAt ? { expiresAt: connection.expiresAt } : {}),
    credentialRevision: connection.credentialRevision ?? 1,
    health: connection.health ?? "active",
    destinations: structuredClone(connection.destinations ?? []),
    ...(connection.defaultDestinationId
      ? { defaultDestinationId: connection.defaultDestinationId }
      : {}),
    connectedAt: connection.connectedAt,
  };
}

export function selectDefaultDestination(
  connection: ConnectionDoc,
  destinationId: string,
): ConnectionDoc {
  if (!connection.destinations?.some((destination) => destination.id === destinationId)) {
    throw new Error("destination is not authorized for this connection");
  }
  return { ...connection, defaultDestinationId: destinationId };
}
