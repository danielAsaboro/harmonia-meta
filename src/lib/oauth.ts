/**
 * OAuth 2.0 authorization-code flow helpers shared by all platform adapters.
 * Tokens are stored server-side only; the browser never sees them.
 */
import { createHash, randomBytes } from "node:crypto";
import { PLATFORMS, type PlatformDef } from "./platforms";
import type { PublishDestination } from "./publishing/contracts";
import { discoverInstagramDestinations } from "./publishing/instagramOAuth";
import { discoverLinkedInDestinations } from "./publishing/linkedinOAuth";
import { discoverYouTubeDestinations } from "./publishing/youtubeOAuth";

export function getPlatform(id: string): PlatformDef | undefined {
  return PLATFORMS.find((p) => p.id === id);
}

export function oauthCredentialEnvNames(def: PlatformDef): {
  clientId: string | undefined;
  clientSecret: string | undefined;
} {
  return {
    clientId: def.requiredEnv.find((name) =>
      name.includes("CLIENT_ID") || name.includes("CLIENT_KEY") || name.endsWith("APP_ID")
    ),
    clientSecret: def.requiredEnv.find((name) =>
      name.includes("CLIENT_SECRET") || name.endsWith("APP_SECRET")
    ),
  };
}

export function randomState(): string {
  return randomBytes(24).toString("base64url");
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function oauthRedirectUri(req: Request, platform: string): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL?.trim();
  const origin = configuredOrigin ? new URL(configuredOrigin).origin : new URL(req.url).origin;
  return new URL(`/api/oauth/${encodeURIComponent(platform)}/callback`, origin).toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  scopes?: string;
}

type RequestFn = (input: string, init?: RequestInit) => Promise<Response>;

function grantedScopes(def: PlatformDef, scopes?: string): string[] {
  return (scopes ?? def.oauth.scopes.join(def.oauth.scopeSeparator))
    .split(/[\s,]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

export async function discoverPublishDestinations(
  def: PlatformDef,
  tokens: Pick<TokenSet, "accessToken" | "scopes">,
  request: RequestFn = fetch,
): Promise<PublishDestination[]> {
  const scopes = grantedScopes(def, tokens.scopes);
  if (def.id === "linkedin" || def.id === "linkedin-organization") {
    return discoverLinkedInDestinations(tokens.accessToken, scopes, request);
  }
  if (def.id === "instagram") return discoverInstagramDestinations(tokens.accessToken, scopes, request);
  if (def.id === "youtube") return discoverYouTubeDestinations(tokens.accessToken, scopes, request);
  return [];
}

/** Revoke the provider grant before deleting the encrypted local credential. */
export async function revokeAccess(
  def: PlatformDef,
  tokens: Pick<TokenSet, "accessToken" | "refreshToken">,
  request: RequestFn = fetch,
): Promise<void> {
  const token = tokens.refreshToken ?? tokens.accessToken;
  let url: string;
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  const body = new URLSearchParams({ token });

  if (def.id === "google-calendar" || def.id === "google-drive" || def.id === "youtube") {
    url = "https://oauth2.googleapis.com/revoke";
  } else if (def.id === "x") {
    url = "https://api.x.com/2/oauth2/revoke";
    const clientId = process.env.X_CLIENT_ID;
    const clientSecret = process.env.X_CLIENT_SECRET;
    if (!clientId || !clientSecret) throw new Error("missing app credentials for x");
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    body.set("client_id", clientId);
  } else {
    throw new Error(`token revocation is not implemented for ${def.id}`);
  }

  const response = await request(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`token revocation failed (${response.status}): ${detail}`);
  }
}

interface ExchangeOptions {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

/** Exchanges an authorization code for tokens using the platform's style. */
export async function exchangeCode(
  def: PlatformDef,
  opts: ExchangeOptions,
): Promise<TokenSet> {
  const credentialEnv = oauthCredentialEnvNames(def);
  const clientId = process.env[credentialEnv.clientId ?? ""];
  const clientSecret = process.env[credentialEnv.clientSecret ?? ""];
  if (!clientId || !clientSecret) {
    throw new Error(`missing app credentials for ${def.id}`);
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
  const clientIdParam = def.oauth.clientIdParam ?? "client_id";
  body.set(clientIdParam, clientId);
  if (opts.codeVerifier) body.set("code_verifier", opts.codeVerifier);

  // Meta (Graph API) takes appsecret_proof-free GET-style params and returns
  // JSON either way; everything else accepts form POST. Auth header vs body:
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (def.oauth.tokenAuth === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    body.delete(clientIdParam); // conveyed via Basic auth
    body.set(clientIdParam, clientId); // harmless duplicates tolerated by X/Google
  } else {
    body.set("client_secret", clientSecret);
  }

  const res = await fetch(def.oauth.tokenUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`token endpoint returned non-JSON (${res.status}): ${text.slice(0, 200)}`);
  }
  if (!res.ok || typeof data.access_token !== "string") {
    const detail =
      typeof data.error_description === "string"
        ? data.error_description
        : typeof data.error === "string"
          ? data.error
          : text.slice(0, 200);
    throw new Error(`token exchange failed (${res.status}): ${detail}`);
  }

  return {
    accessToken: data.access_token as string,
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : undefined,
    expiresInSeconds: typeof data.expires_in === "number" ? data.expires_in : undefined,
    scopes: typeof data.scope === "string" ? data.scope : undefined,
  };
}

export async function refreshAccessToken(def: PlatformDef, refreshToken: string): Promise<TokenSet> {
  const credentialEnv = oauthCredentialEnvNames(def);
  const clientId = process.env[credentialEnv.clientId ?? ""];
  const clientSecret = process.env[credentialEnv.clientSecret ?? ""];
  if (!clientId || !clientSecret) {
    throw new Error(`missing app credentials for ${def.id}`);
  }
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  body.set(def.oauth.clientIdParam ?? "client_id", clientId);
  const headers: Record<string, string> = {
    "content-type": "application/x-www-form-urlencoded",
    accept: "application/json",
  };
  if (def.oauth.tokenAuth === "basic") {
    headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
  } else {
    body.set("client_secret", clientSecret);
  }
  const res = await fetch(def.oauth.tokenUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`refresh returned non-JSON (${res.status})`);
  }
  if (!res.ok || typeof data.access_token !== "string") {
    throw new Error(`refresh failed (${res.status}): ${text.slice(0, 200)}`);
  }
  return {
    accessToken: data.access_token as string,
    // X rotates refresh tokens on each use; Google/Meta keep the same one.
    refreshToken: typeof data.refresh_token === "string" ? data.refresh_token : refreshToken,
    expiresInSeconds: typeof data.expires_in === "number" ? data.expires_in : undefined,
  };
}

/** Best-effort account identity after connecting (never blocks the flow). */
export async function fetchIdentity(
  def: PlatformDef,
  accessToken: string,
): Promise<{ handle?: string; accountId?: string } | null> {
  try {
    if (def.id === "x") {
      const res = await fetch("https://api.x.com/2/users/me", {
        headers: { authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) {
        const data = await res.json();
        return { handle: `@${data?.data?.username}`, accountId: data?.data?.id };
      }
    }
    if (def.id === "youtube") {
      const res = await fetch(
        "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
        { headers: { authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(10_000) },
      );
      if (res.ok) {
        const data = await res.json();
        const title = data?.items?.[0]?.snippet?.title;
        if (title) return { handle: title };
      }
    }
  } catch {
    // identity is cosmetic; connection still stands on valid tokens
  }
  return null;
}
