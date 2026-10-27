import type { ConnectionDoc } from "./firestore";

interface DisconnectDependencies {
  get(platform: string): Promise<ConnectionDoc | null>;
  revoke(connection: ConnectionDoc): Promise<void>;
  remove(platform: string): Promise<void>;
}

/** Provider-first disconnect: a failed revoke must leave the encrypted token retryable. */
export async function disconnectConnection(
  platform: string,
  dependencies: DisconnectDependencies,
): Promise<void> {
  const connection = await dependencies.get(platform);
  if (!connection) return;
  await dependencies.revoke(connection);
  await dependencies.remove(platform);
}
