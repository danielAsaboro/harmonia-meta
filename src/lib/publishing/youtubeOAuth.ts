import type { PublishDestination } from "./contracts";

type RequestFn = (input: string, init?: RequestInit) => Promise<Response>;

const UPLOAD_SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const READ_SCOPE = "https://www.googleapis.com/auth/youtube.readonly";
const CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=id&mine=true";

export async function discoverYouTubeDestinations(
  accessToken: string,
  grantedScopes: readonly string[],
  request: RequestFn = fetch,
): Promise<PublishDestination[]> {
  const scopes = new Set(grantedScopes);
  if (!scopes.has(UPLOAD_SCOPE) || !scopes.has(READ_SCOPE)) {
    throw new Error("YouTube upload and read permissions are required");
  }
  const response = await request(CHANNELS_URL, {
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(20_000),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = body && typeof body === "object" && !Array.isArray(body)
      ? (body as { error?: { errors?: Array<{ reason?: unknown }> } }).error?.errors?.[0]?.reason
      : undefined;
    const safeReason = typeof reason === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(reason)
      ? `: ${reason}`
      : "";
    throw new Error(`YouTube channel discovery failed (${response.status}${safeReason})`);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error("YouTube channel discovery response was invalid");
  }
  const items = Array.isArray((body as Record<string, unknown>).items)
    ? (body as Record<string, unknown>).items as unknown[]
    : [];
  const ids = items.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const id = (item as Record<string, unknown>).id;
    return typeof id === "string" && id ? [id] : [];
  });
  if (ids.length !== 1) throw new Error("connected Google identity must resolve exactly one YouTube channel");
  return [{ kind: "youtube_channel", id: ids[0] }];
}
