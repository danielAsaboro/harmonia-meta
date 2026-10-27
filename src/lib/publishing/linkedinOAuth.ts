import type { PublishDestination } from "./contracts";

type RequestFn = (input: string, init?: RequestInit) => Promise<Response>;

const LINKEDIN_API = "https://api.linkedin.com";
const MEMBER_SCOPE = "w_member_social";
const ORGANIZATION_SCOPE = "w_organization_social";

async function linkedInJson(
  path: string,
  label: string,
  accessToken: string,
  request: RequestFn,
): Promise<Record<string, unknown>> {
  const response = await request(`${LINKEDIN_API}${path}`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`,
      "linkedin-version": "202608",
      "x-restli-protocol-version": "2.0.0",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`LinkedIn ${label} request failed (${response.status})`);
  const body: unknown = await response.json();
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new Error(`LinkedIn ${label} response was invalid`);
  }
  return body as Record<string, unknown>;
}

function organizationId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^urn:li:organization:([^:]+)$/.exec(value);
  return match?.[1] ?? null;
}

export async function discoverLinkedInDestinations(
  accessToken: string,
  grantedScopes: readonly string[],
  request: RequestFn = fetch,
): Promise<PublishDestination[]> {
  const scopes = new Set(grantedScopes);
  if (!scopes.has(MEMBER_SCOPE) && !scopes.has(ORGANIZATION_SCOPE)) {
    throw new Error("LinkedIn publishing permission is required");
  }

  const destinations: PublishDestination[] = [];
  if (scopes.has(MEMBER_SCOPE)) {
    const member = await linkedInJson("/v2/userinfo", "identity", accessToken, request);
    if (typeof member.sub !== "string" || !member.sub) {
      throw new Error("LinkedIn identity response was invalid");
    }
    destinations.push({ kind: "linkedin_member", id: member.sub });
  }
  if (!scopes.has(ORGANIZATION_SCOPE)) return destinations;

  const query = new URLSearchParams({
    q: "roleAssignee",
    role: "ADMINISTRATOR",
    state: "APPROVED",
  });
  const result = await linkedInJson(
    `/rest/organizationAcls?${query.toString()}`,
    "organization authority",
    accessToken,
    request,
  );
  const elements = Array.isArray(result.elements) ? result.elements : [];
  const seen = new Set<string>();
  for (const entry of elements) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    if (record.state !== "APPROVED" || record.role !== "ADMINISTRATOR") continue;
    const id = organizationId(record.organizationalTarget);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    destinations.push({ kind: "linkedin_organization", id });
  }
  return destinations;
}
