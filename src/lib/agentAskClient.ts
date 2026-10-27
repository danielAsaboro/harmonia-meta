import { GoogleAuth } from "google-auth-library";
import { getConfig } from "@/lib/config";
import { currentTenant, tenantSubjectId } from "@/lib/tenancy";

interface AgentTenantHeaders {
  workspaceId: string;
  brandId: string;
  userId: string;
}

interface AgentAskOptions {
  baseUrl?: string;
  token?: string;
  tenant?: AgentTenantHeaders;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface AgentToolActivity {
  sequence: number;
  toolName: string;
  status: "succeeded" | "failed";
  publicMessage: string;
  code?: string;
  category?: "validation" | "authorization" | "not_found" | "dependency" | "provider_permanent";
  retryable?: boolean;
}

export interface AgentAskResult { answer: string; operationId: string; traceId: string; activity: AgentToolActivity[] }

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
    if (record.detail && typeof record.detail === "object") {
      const detail = record.detail as Record<string, unknown>;
      if (typeof detail.message === "string" && typeof detail.code === "string") {
        return `${detail.message} [${detail.code}]`;
      }
    }
    if (typeof record.error === "string") return record.error;
  }
  return `insight agent failed (${status})`;
}

/**
 * Routes a free-form operator question to the skill-enabled ADK liaison on
 * the agent worker. Read-only by contract; publishing still requires the
 * normal approval flow.
 */
export async function requestAgentAnswer(
  question: string,
  options: AgentAskOptions = {},
): Promise<AgentAskResult> {
  const config = options.baseUrl && options.token ? null : getConfig();
  const baseUrl = normalizedBaseUrl(options.baseUrl ?? config?.AGENT_SERVICE_URL ?? "");
  const token = options.token ?? config?.INTERNAL_API_TOKEN ?? "";
  const tenant = options.tenant ?? (() => {
    const context = currentTenant();
    return { workspaceId: context.workspaceId, brandId: context.brandId, userId: tenantSubjectId(context) };
  })();
  const url = `${baseUrl}/internal/agent/ask`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 45_000);
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
      body: JSON.stringify({ question }),
      signal: controller.signal,
    };
    const response = options.fetchImpl
      ? await options.fetchImpl(url, init)
      : isLocalAgent(baseUrl)
        ? await fetch(url, init)
        : await cloudRunFetch(url, init, baseUrl);
    const data = (await response.json().catch(() => null)) as
      | { answer?: unknown; operationId?: unknown; traceId?: unknown; activity?: unknown; detail?: string; error?: string }
      | null;
    if (!response.ok) throw new Error(errorDetail(data, response.status));
    if (!data || typeof data.answer !== "string" || !data.answer.trim()) {
      throw new Error("insight agent returned no answer");
    }
    if (typeof data.operationId !== "string" || typeof data.traceId !== "string" || !Array.isArray(data.activity)) {
      throw new Error("insight agent returned no activity contract");
    }
    return { answer: data.answer.trim(), operationId: data.operationId, traceId: data.traceId, activity: data.activity as AgentToolActivity[] };
  } finally {
    clearTimeout(timer);
  }
}
