import { Timestamp } from "@google-cloud/firestore";
import { db, getConnection, saveConnection } from "@/lib/firestore";
import { discoverPublishDestinations, exchangeCode, fetchIdentity, getPlatform } from "@/lib/oauth";
import { currentTenant, runWithTenant } from "@/lib/tenancy";
import { oauthCallbackPrincipal, requireOAuthCallback } from "@/lib/authority";

function backToSettings(platform: string, result: "ok" | "error", reason?: string): Response {
  const q = new URLSearchParams({ connection: platform, result });
  if (reason) q.set("reason", reason);
  return new Response(null, {
    status: 302,
    headers: { location: `/dashboard/settings?${q.toString()}` },
  });
}

/**
 * OAuth callback: validates single-use state, exchanges the code server-side,
 * stores tokens (browser never sees them), then returns to Settings.
 * NOTE: tokens live in Firestore; production should mirror them to Secret
 * Manager before real accounts are connected.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const def = getPlatform(platform);
  if (!def) return backToSettings(platform, "error", "unknown platform");
  if (def.productAvailability === "credential_groundwork") {
    return backToSettings(platform, "error", "credential groundwork only; publishing is not implemented");
  }

  const url = new URL(req.url);
  const error = url.searchParams.get("error_description") ?? url.searchParams.get("error");
  if (error) return backToSettings(platform, "error", error);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return backToSettings(platform, "error", "missing code/state");

  const stateRef = db().collection("oauth_states").doc(state);
  const stateSnap = await stateRef.get();
  if (!stateSnap.exists) {
    return backToSettings(platform, "error", "invalid or expired state");
  }
  const stored = stateSnap.data() as {
    platform: string;
    codeVerifier: string;
    redirectUri: string;
    createdAt: string;
    workspaceId: string;
    brandId: string;
  };
  await stateRef.delete(); // single use

  if (stored.platform !== platform) {
    return backToSettings(platform, "error", "state/platform mismatch");
  }
  const ageMin = (Date.now() - Timestamp.fromMillis(Date.parse(stored.createdAt)).toMillis()) / 60_000;
  if (ageMin > 10) {
    return backToSettings(platform, "error", "authorization attempt expired; try again");
  }

  let tokens;
  try {
    tokens = await exchangeCode(def, {
      code,
      redirectUri: stored.redirectUri,
      codeVerifier: stored.codeVerifier || undefined,
    });
  } catch (e) {
    return backToSettings(platform, "error", e instanceof Error ? e.message : String(e));
  }

  let destinations;
  try {
    destinations = await discoverPublishDestinations(def, tokens);
  } catch (e) {
    return backToSettings(platform, "error", e instanceof Error ? e.message : "destination discovery failed");
  }
  const identity = await fetchIdentity(def, tokens.accessToken);
  await runWithTenant(
    {
      workspaceId: stored.workspaceId,
      brandId: stored.brandId,
      principal: oauthCallbackPrincipal({ stateId: state, platform }),
    },
    async () => {
      requireOAuthCallback(currentTenant(), platform);
      const existing = await getConnection(platform);
      const defaultDestinationId = existing?.defaultDestinationId && destinations.some(
        (destination) => destination.id === existing.defaultDestinationId,
      )
        ? existing.defaultDestinationId
        : destinations.length === 1 ? destinations[0].id : undefined;
      await saveConnection({
        ...existing,
        platform,
        mode: "oauth",
        handle: identity?.handle ?? existing?.handle,
        accountId: identity?.accountId ?? existing?.accountId,
        scopes: tokens.scopes ?? def.oauth.scopes.join(def.oauth.scopeSeparator),
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken ?? existing?.refreshToken,
        expiresAt: tokens.expiresInSeconds
          ? new Date(Date.now() + tokens.expiresInSeconds * 1000).toISOString()
          : existing?.expiresAt,
        credentialRevision: (existing?.credentialRevision ?? 0) + 1,
        health: "active",
        destinations,
        defaultDestinationId,
        connectedAt: new Date().toISOString(),
      });
    },
  );

  return backToSettings(platform, "ok");
}
