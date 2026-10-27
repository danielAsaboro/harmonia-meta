import { replayEventSchema, type ReplayEvent } from "./schema";

const forbiddenKeys = /(^|_)(authorization(header)?|cookie|setcookie|access_?token|refresh_?token|api_?key|private_?key|client_?secret|password|chain_?of_?thought|raw_?prompt|stack_?trace|headers?|environment|env)(_|$)/i;
const forbiddenValues = /(bearer\s+[a-z0-9._~+\/-]{8,}|basic\s+[a-z0-9+/=]{8,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|[?&](?:access_token|api_key|signature|x-goog-signature)=)/i;
export class ReplaySanitizationError extends Error {}

export function assertNoForbiddenReplayMaterial(value: unknown, path = "bundle"): void {
  if (typeof value === "string" && forbiddenValues.test(value)) throw new ReplaySanitizationError(`forbidden credential material at ${path}`);
  if (Array.isArray(value)) return value.forEach((entry, index) => assertNoForbiddenReplayMaterial(entry, `${path}.${index}`));
  if (!value || typeof value !== "object") return;
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
    if (forbiddenKeys.test(normalized)) throw new ReplaySanitizationError(`forbidden field at ${path}.${key}`);
    assertNoForbiddenReplayMaterial(entry, `${path}.${key}`);
  }
}

const allowed: Record<string, string[]> = {
  job_snapshot: ["jobId", "stage", "status", "traceId"], stage_transition: ["jobId", "stage", "status", "traceId"],
  specialist_handoff: ["jobId", "traceId", "from", "to", "summary"], activity_summary: ["jobId", "traceId", "specialist", "summary", "status"],
  transcript_segment: ["jobId", "traceId", "segmentId", "startSec", "endSec", "text"], moment: ["jobId", "traceId", "momentId", "title", "startSec", "endSec"],
  draft: ["jobId", "traceId", "draftId", "platform", "text", "valid"], action: ["jobId", "traceId", "actionId", "actionType", "state"],
  approval: ["jobId", "traceId", "actionId", "decision", "actor"], effect_claim: ["jobId", "traceId", "actionId", "outcome", "receiptId"],
  receipt: ["jobId", "traceId", "receiptId", "actionId", "outcome", "verified"], verification: ["jobId", "traceId", "receiptId", "verified", "method"],
  pubsub_delivery: ["jobId", "traceId", "messageId", "deliveryAttempt", "status"], scheduler_trigger: ["jobId", "traceId", "scheduleId", "scheduledAt", "status"],
  resident_autonomy: ["cycleId", "cycleType", "state", "summary", "historical"],
  a2ui_event: ["jobId", "traceId", "runId", "surfaceId", "operation"], surface_revision: ["jobId", "traceId", "surfaceId", "revision", "status"],
  usage: ["jobId", "traceId", "model", "inputTokens", "outputTokens", "estimatedCostUsd"], trace_correlation: ["jobId", "traceId", "spanId", "parentSpanId", "name"],
  failure: ["jobId", "traceId", "failureType", "code", "message", "retryable"],
};
export function sanitizeReplayObservation(input: unknown, context: { sourceCaptureAuthorized: boolean }): ReplayEvent {
  assertNoForbiddenReplayMaterial(input);
  if (!input || typeof input !== "object") throw new ReplaySanitizationError("observation must be an object");
  const raw = input as Record<string, unknown>; const kind = String(raw.kind ?? ""); const keys = allowed[kind];
  if (!keys) throw new ReplaySanitizationError(`unsupported replay event kind: ${kind}`);
  if ((kind === "transcript_segment" || kind === "draft") && !context.sourceCaptureAuthorized) throw new ReplaySanitizationError("source capture authorization is required");
  const payloadInput = raw.payload as Record<string, unknown>; const payload = Object.fromEntries(keys.filter((key) => payloadInput?.[key] !== undefined).map((key) => [key, payloadInput[key]]));
  return replayEventSchema.parse({ sequence: raw.sequence, capturedAt: raw.capturedAt, offsetMs: raw.offsetMs, kind, payload });
}
