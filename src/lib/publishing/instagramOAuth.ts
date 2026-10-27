import type { PublishDestination } from "./contracts";

type RequestFn = (input: string, init?: RequestInit) => Promise<Response>;

const REQUIRED_SCOPES = ["instagram_basic", "instagram_content_publish", "pages_show_list"] as const;
const FIRST_PAGE = "https://graph.facebook.com/v21.0/me/accounts?fields=id%2Cinstagram_business_account&limit=100";

function safeNext(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "graph.facebook.com") {
    throw new Error("Instagram pagination response was invalid");
  }
  return url.toString();
}

export async function discoverInstagramDestinations(
  accessToken: string,
  grantedScopes: readonly string[],
  request: RequestFn = fetch,
): Promise<PublishDestination[]> {
  const scopes = new Set(grantedScopes);
  if (REQUIRED_SCOPES.some((scope) => !scopes.has(scope))) {
    throw new Error("Instagram publishing permissions are required");
  }

  const destinations: PublishDestination[] = [];
  const seen = new Set<string>();
  let next: string | null = FIRST_PAGE;
  let pageCount = 0;
  while (next) {
    if (++pageCount > 20) throw new Error("Instagram pagination limit exceeded");
    const response = await request(next, {
      headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Instagram Page discovery failed (${response.status})`);
    const body: unknown = await response.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      throw new Error("Instagram Page discovery response was invalid");
    }
    const record = body as Record<string, unknown>;
    const pages = Array.isArray(record.data) ? record.data : [];
    for (const page of pages) {
      if (!page || typeof page !== "object" || Array.isArray(page)) continue;
      const pageRecord = page as Record<string, unknown>;
      const professional = pageRecord.instagram_business_account;
      if (!professional || typeof professional !== "object" || Array.isArray(professional)) continue;
      const id = (professional as Record<string, unknown>).id;
      const pageId = pageRecord.id;
      if (typeof id !== "string" || !id || typeof pageId !== "string" || !pageId || seen.has(id)) continue;
      seen.add(id);
      destinations.push({ kind: "instagram_professional", id, pageId });
    }
    const paging = record.paging;
    next = paging && typeof paging === "object" && !Array.isArray(paging)
      ? safeNext((paging as Record<string, unknown>).next)
      : null;
  }
  return destinations;
}
