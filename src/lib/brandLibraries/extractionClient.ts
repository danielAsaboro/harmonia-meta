import { GoogleAuth } from "google-auth-library";
import { getConfig } from "../config";
import { normalizedSourceSchema } from "../contracts";
import { currentTenant, tenantSubjectId } from "../tenancy";
import type { NormalizedSource } from "../types";
const local = (url: string) => ["localhost", "127.0.0.1", "::1"].includes(new URL(url).hostname);
export async function extractLibraryBytes(input: { sourceId: string; title: string; mimeType: string; bytes: Buffer; receiptId: string; limits: { maximumBytes: number; maximumCharacters: number; maximumMediaDurationSeconds: number; maximumCostUsd: string } }): Promise<NormalizedSource> {
  if (input.bytes.length > 20 * 1024 * 1024) throw new Error("library file exceeds extraction byte limit");
  const config = getConfig(); const base = config.AGENT_SERVICE_URL.replace(/\/$/, ""); const url = `${base}/internal/sources/extract`; const tenant = currentTenant();
  const headers = new Headers({ "content-type": "application/json", "x-harmonia-internal-token": config.INTERNAL_API_TOKEN, "x-workspace-id": tenant.workspaceId, "x-brand-id": tenant.brandId, "x-user-id": tenantSubjectId(tenant) });
  if (!local(base)) { const client = await new GoogleAuth().getIdTokenClient(base); (await client.getRequestHeaders(url)).forEach((value, name) => headers.set(name, value)); }
  const response = await fetch(url, { method: "POST", headers, body: JSON.stringify({ ...input, bytes: undefined, bodyBase64: input.bytes.toString("base64"), limits: { maximum_bytes: input.limits.maximumBytes, maximum_characters: input.limits.maximumCharacters, maximum_media_duration_seconds: input.limits.maximumMediaDurationSeconds, maximum_cost_usd: input.limits.maximumCostUsd } }), signal: AbortSignal.timeout(180_000) });
  const body = await response.json().catch(() => null); if (!response.ok) throw new Error(`source extraction failed (${response.status}): ${typeof body?.detail === "string" ? body.detail : "provider error"}`);
  return normalizedSourceSchema.parse(body);
}
