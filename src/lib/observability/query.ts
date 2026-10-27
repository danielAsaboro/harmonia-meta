import { decodeActivityCursor } from "@/lib/observability/repository";
import {
  observabilityQuerySchema,
  type ObservabilityQuery,
} from "@/lib/observability/schema";

export function parseObservabilityQuery(url: URL): ObservabilityQuery {
  const params = url.searchParams;
  const cursor = params.get("cursor") || undefined;
  if (cursor) decodeActivityCursor(cursor);
  return observabilityQuerySchema.parse({
    types: params.getAll("type").filter(Boolean),
    agent: params.get("agent") || undefined,
    stage: params.get("stage") || undefined,
    outcome: params.get("outcome") || undefined,
    severity: params.get("severity") || undefined,
    model: params.get("model") || undefined,
    tool: params.get("tool") || undefined,
    jobId: params.get("jobId") || undefined,
    traceId: params.get("traceId") || undefined,
    since: params.get("since") || undefined,
    until: params.get("until") || undefined,
    q: params.get("q") || undefined,
    limit: params.has("limit") ? Number(params.get("limit")) : 25,
    cursor,
  });
}
