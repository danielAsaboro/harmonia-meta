export type ConnectionRefreshState =
  | { status: "claimed"; claimId: string; claimedAt: string; expiresAt: string }
  | { status: "uncertain"; claimId: string; claimedAt: string; expiresAt: string; uncertainAt: string; reason: string };

export type ConnectionRefreshDecision =
  | { outcome: "fresh" }
  | { outcome: "refresh"; state: Extract<ConnectionRefreshState, { status: "claimed" }> }
  | { outcome: "in_progress"; state: Extract<ConnectionRefreshState, { status: "claimed" }> }
  | { outcome: "uncertain"; state: Extract<ConnectionRefreshState, { status: "uncertain" }> };

export function decideConnectionRefresh(input: {
  expiresAt?: string;
  now: string;
  refreshSkewMs: number;
  state?: ConnectionRefreshState;
  claimId?: string;
  leaseMs?: number;
}): ConnectionRefreshDecision {
  if (!input.expiresAt || Date.parse(input.expiresAt) > Date.parse(input.now) + input.refreshSkewMs) {
    return { outcome: "fresh" };
  }
  if (input.state?.status === "uncertain") return { outcome: "uncertain", state: input.state };
  if (input.state?.status === "claimed") {
    if (Date.parse(input.state.expiresAt) > Date.parse(input.now)) {
      return { outcome: "in_progress", state: input.state };
    }
    return {
      outcome: "uncertain",
      state: {
        ...input.state,
        status: "uncertain",
        uncertainAt: input.now,
        reason: "refresh lease expired before rotated credentials were persisted",
      },
    };
  }
  if (!input.claimId) throw new Error("refresh claim id required");
  return {
    outcome: "refresh",
    state: {
      status: "claimed",
      claimId: input.claimId,
      claimedAt: input.now,
      expiresAt: new Date(Date.parse(input.now) + (input.leaseMs ?? 120_000)).toISOString(),
    },
  };
}

export interface RefreshableConnection {
  platform: string;
  mode: "oauth" | "manual" | "env";
  accessToken: string;
  refreshToken?: string;
  expiresAt?: string;
  connectedAt: string;
}

type RefreshClaim<C extends RefreshableConnection> =
  | { outcome: "fresh"; connection: C }
  | { outcome: "refresh"; claimId: string; connection: C }
  | { outcome: "in_progress" }
  | { outcome: "uncertain" };

export async function getValidConnection<C extends RefreshableConnection>(
  platform: string,
  deps: {
    claim: (platform: string) => Promise<RefreshClaim<C>>;
    refresh: (platform: string, refreshToken: string) => Promise<{ accessToken: string; refreshToken?: string; expiresInSeconds?: number }>;
    complete: (platform: string, claimId: string, connection: C) => Promise<void>;
    markUncertain: (platform: string, claimId: string, reason: string) => Promise<void>;
    now?: () => Date;
  },
): Promise<C> {
  const claimed = await deps.claim(platform);
  if (claimed.outcome === "fresh") return claimed.connection;
  if (claimed.outcome === "in_progress") throw new Error("connection refresh is already in progress");
  if (claimed.outcome === "uncertain") throw new Error("connection refresh outcome is uncertain; reconnect before use");
  const { claimId, connection } = claimed;
  if (!connection.refreshToken) throw new Error(`${platform} authorization expired; reconnect it`);
  try {
    const tokens = await deps.refresh(platform, connection.refreshToken);
    const now = deps.now?.() ?? new Date();
    const refreshed = {
      ...connection,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken ?? connection.refreshToken,
      expiresAt: tokens.expiresInSeconds
        ? new Date(now.getTime() + tokens.expiresInSeconds * 1000).toISOString()
        : connection.expiresAt,
    } as C;
    await deps.complete(platform, claimId, refreshed);
    return refreshed;
  } catch (error) {
    await deps.markUncertain(platform, claimId, "refresh request or credential persistence outcome is ambiguous");
    throw new Error("connection refresh failed and was quarantined", { cause: error });
  }
}
