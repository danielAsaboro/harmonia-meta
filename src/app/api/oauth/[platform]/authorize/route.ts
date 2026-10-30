import { db } from "@/lib/firestore";
import { getPlatform, oauthCredentialEnvNames, oauthRedirectUri, pkcePair, randomState } from "@/lib/oauth";
import { administratorTenantHandler } from "@/lib/auth";
import { platformStatus } from "@/lib/platforms";
import { currentTenant } from "@/lib/tenancy";

function backToSettings(status: string, reason: string): Response {
  return new Response(null, {
    status: 302,
    headers: { location: `/dashboard/settings?connection=${encodeURIComponent(reason)}&result=${status}` },
  });
}

/**
 * Starts the OAuth 2.0 authorization-code flow: stores a single-use state
 * (with PKCE verifier where supported) and redirects to the platform's
 * consent screen. Client IDs/secrets never leave the server.
 */
async function get(
  req: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const def = getPlatform(platform);
  if (!def) return backToSettings("error", `unknown platform ${platform}`);
  if (def.productAvailability === "credential_groundwork") {
    return backToSettings("error", `${def.label}: credential groundwork only; publishing is not implemented`);
  }

  const status = platformStatus(def);
  if (status.status === "credentials_needed") {
    return backToSettings("error", `${def.label}: missing app config (${status.missingRequired.join(", ")})`);
  }
  if (def.requiredEnv.some((e) => !process.env[e])) {
    return backToSettings("error", `${def.label}: missing app credentials`);
  }

  const redirectUri = oauthRedirectUri(req, platform);
  const state = randomState();
  const pkce = def.oauth.usesPkce ? pkcePair() : null;

  await db()
    .collection("oauth_states")
    .doc(state)
    .set({
      platform,
      codeVerifier: pkce?.verifier ?? "",
      redirectUri,
      workspaceId: currentTenant().workspaceId,
      brandId: currentTenant().brandId,
      createdAt: new Date().toISOString(),
    });

  const url = new URL(def.oauth.authorizeUrl);
  const credentialEnv = oauthCredentialEnvNames(def);
  url.searchParams.set(def.oauth.clientIdParam ?? "client_id", process.env[credentialEnv.clientId ?? ""] ?? "");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  url.searchParams.set("scope", def.oauth.scopes.join(def.oauth.scopeSeparator));
  for (const [k, v] of Object.entries(def.oauth.extraAuthorizeParams ?? {})) {
    url.searchParams.set(k, v);
  }
  for (const [parameter, envName] of Object.entries(def.oauth.extraAuthorizeEnvParams ?? {})) {
    url.searchParams.set(parameter, process.env[envName] ?? "");
  }
  if (pkce) {
    url.searchParams.set("code_challenge", pkce.challenge);
    url.searchParams.set("code_challenge_method", "S256");
  }

  return new Response(null, { status: 302, headers: { location: url.toString() } });
}

export const GET = administratorTenantHandler(get);
