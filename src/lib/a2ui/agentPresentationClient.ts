import { GoogleAuth } from "google-auth-library";
import { getConfig } from "@/lib/config";
import { currentTenant, tenantSubjectId } from "@/lib/tenancy";
import { surfacePlanSchema, type SurfacePlan, type UiContext } from "./presentationContracts";

interface PresentationTenantHeaders {
  workspaceId: string;
  brandId: string;
  userId: string;
}

interface PresentationClientOptions {
  baseUrl?: string;
  token?: string;
  tenant?: PresentationTenantHeaders;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

function normalizedBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AGENT_SERVICE_URL must use HTTP(S)");
  }
  return url.toString().replace(/\/$/, "");
}

function isLocalAgent(url: string): boolean {
  const hostname = new URL(url).hostname;
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

async function cloudRunFetch(url: string, init: RequestInit, audience: string): Promise<Response> {
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(audience);
  const identityHeaders = await client.getRequestHeaders(url);
  const headers = new Headers(init.headers);
  identityHeaders.forEach((value, name) => headers.set(name, value));
  return fetch(url, { ...init, headers });
}

function errorDetail(value: unknown, status: number): string {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;
    if (typeof record.error === "string") return record.error;
  }
  return `presentation agent failed (${status})`;
}

export async function requestSurfacePlan(
  context: UiContext,
  options: PresentationClientOptions = {},
): Promise<SurfacePlan> {
  const config = options.baseUrl && options.token ? null : getConfig();
  const baseUrl = normalizedBaseUrl(options.baseUrl ?? config?.AGENT_SERVICE_URL ?? "");
  const token = options.token ?? config?.INTERNAL_API_TOKEN ?? "";
  const tenant = options.tenant ?? (() => {
    const context = currentTenant();
    return { workspaceId: context.workspaceId, brandId: context.brandId, userId: tenantSubjectId(context) };
  })();
  const url = `${baseUrl}/internal/a2ui/plan`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 25_000);
  try {
    const init: RequestInit = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-harmonia-internal-token": token,
        "x-workspace-id": tenant.workspaceId,
        "x-brand-id": tenant.brandId,
        "x-user-id": tenant.userId,
      },
      body: JSON.stringify(context),
      signal: controller.signal,
    };
    const response = options.fetchImpl
      ? await options.fetchImpl(url, init)
      : isLocalAgent(baseUrl)
        ? await fetch(url, init)
        : await cloudRunFetch(url, init, baseUrl);
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(errorDetail(data, response.status));
    const parsed = surfacePlanSchema.safeParse(data);
    if (!parsed.success) {
      throw new Error(`invalid A2UI surface plan: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
    }
    return parsed.data;
  } finally {
    clearTimeout(timer);
  }
}
