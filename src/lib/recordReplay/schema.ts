import { z } from "zod";

export const REPLAY_SCHEMA_VERSION = "1.0.0" as const;
export const replayScenarioSchema = z.enum(["success", "awaiting_approval", "rejection", "transient_recovery", "permanent_failure", "duplicate_effect_suppression", "scheduled_autonomy", "memory_bank_retrieval", "telegram_approval"]);
export type ReplayScenario = z.infer<typeof replayScenarioSchema>;

const id = z.string().min(1).max(300);
const iso = z.string().datetime();
const status = z.string().min(1).max(100);
const commonPayload = { jobId: id.optional(), traceId: id.optional() };
const eventPayloads = {
  job_snapshot: z.object({ ...commonPayload, jobId: id, stage: status, status }).strict(),
  stage_transition: z.object({ ...commonPayload, jobId: id, stage: status, status }).strict(),
  specialist_handoff: z.object({ ...commonPayload, from: id, to: id, summary: z.string().max(2000) }).strict(),
  activity_summary: z.object({ ...commonPayload, specialist: id, summary: z.string().max(2000), status }).strict(),
  transcript_segment: z.object({ ...commonPayload, segmentId: id, startSec: z.number().nonnegative(), endSec: z.number().nonnegative(), text: z.string().max(5000) }).strict(),
  moment: z.object({ ...commonPayload, momentId: id, title: z.string().max(500), startSec: z.number().nonnegative(), endSec: z.number().nonnegative() }).strict(),
  draft: z.object({ ...commonPayload, draftId: id, platform: id, text: z.string().max(20000), valid: z.boolean() }).strict(),
  action: z.object({ ...commonPayload, actionId: id, actionType: id, state: status }).strict(),
  approval: z.object({ ...commonPayload, actionId: id, decision: z.enum(["pending", "approved", "rejected"]), actor: z.string().max(200).optional() }).strict(),
  effect_claim: z.object({ ...commonPayload, actionId: id, outcome: z.enum(["execute", "already_applied", "in_progress", "uncertain"]), receiptId: id.optional() }).strict(),
  receipt: z.object({ ...commonPayload, receiptId: id, actionId: id, outcome: z.enum(["applied", "already_applied", "rejected", "failed"]), verified: z.boolean() }).strict(),
  verification: z.object({ ...commonPayload, receiptId: id, verified: z.boolean(), method: z.string().max(500) }).strict(),
  pubsub_delivery: z.object({ ...commonPayload, messageId: id, deliveryAttempt: z.number().int().positive(), status }).strict(),
  scheduler_trigger: z.object({ ...commonPayload, scheduleId: id, scheduledAt: iso, status }).strict(),
  resident_autonomy: z.object({ cycleId: id, cycleType: z.enum(["heartbeat", "micro_reflection", "dream_cycle", "wakeup_call"]), state: status, summary: z.string().max(2000), historical: z.literal(true) }).strict(),
  a2ui_event: z.object({ ...commonPayload, runId: id, surfaceId: id, operation: z.string().max(4000) }).strict(),
  surface_revision: z.object({ ...commonPayload, surfaceId: id, revision: z.number().int().nonnegative(), status }).strict(),
  usage: z.object({ ...commonPayload, model: id, inputTokens: z.number().int().nonnegative(), outputTokens: z.number().int().nonnegative(), estimatedCostUsd: z.number().nonnegative() }).strict(),
  trace_correlation: z.object({ ...commonPayload, traceId: id, spanId: id, parentSpanId: id.optional(), name: z.string().max(500) }).strict(),
  failure: z.object({ ...commonPayload, failureType: z.enum(["transient_provider", "permanent_provider", "policy_quarantine", "authorization", "delivery", "verification", "replay_integrity"]), code: id, message: z.string().max(2000), retryable: z.boolean() }).strict(),
} as const;

const variants = Object.entries(eventPayloads).map(([kind, payload]) => z.object({ sequence: z.number().int().nonnegative(), capturedAt: iso, offsetMs: z.number().int().nonnegative(), kind: z.literal(kind), payload }).strict());
export const replayEventSchema = z.union(variants as [typeof variants[0], typeof variants[0], ...typeof variants]);
export type ReplayEvent = z.infer<typeof replayEventSchema>;

export const unsignedReplayBundleSchema = z.object({
  schema: z.literal("harmonia.authenticated-replay"), schemaVersion: z.literal(REPLAY_SCHEMA_VERSION), bundleId: id,
  executionMode: z.literal("recorded_replay"), evidenceClassification: z.literal("historical_replay"), scenario: replayScenarioSchema,
  capturedAt: iso, captureEndedAt: iso, release: z.enum(["private_candidate", "approved_public_bundle"]),
  provenance: z.object({ sourceRunId: id, sourceJobId: id.optional(), environment: z.literal("authenticated_cloud"), sanitizerVersion: z.literal("1.0.0"), sourceCaptureAuthorized: z.boolean() }).strict(),
  events: z.array(replayEventSchema).max(10000), terminalStateDigest: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().superRefine((bundle, ctx) => {
  bundle.events.forEach((event, index) => { if (event.sequence !== index) ctx.addIssue({ code: "custom", path: ["events", index, "sequence"], message: "event sequence must be contiguous and zero-based" }); });
  for (let index = 1; index < bundle.events.length; index += 1) if (bundle.events[index].offsetMs < bundle.events[index - 1].offsetMs) ctx.addIssue({ code: "custom", path: ["events", index, "offsetMs"], message: "event offsets must not decrease" });
});
export type UnsignedReplayBundle = z.infer<typeof unsignedReplayBundleSchema>;
export const replayBundleSchema = unsignedReplayBundleSchema.safeExtend({ integrity: z.object({ algorithm: z.literal("sha256-canonical-json"), digest: z.string().regex(/^[a-f0-9]{64}$/) }).strict() }).strict();
export type ReplayBundle = z.infer<typeof replayBundleSchema>;
