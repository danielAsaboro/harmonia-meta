import { z } from "zod";

const id = z.string().min(1).max(300);
const timestamp = z.string().datetime({ offset: true });
const scope = { workspaceId: id, brandId: id } as const;
const evidenceRefs = z.array(id).max(500);
const jsonScalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const cycleTypeSchema = z.enum(["heartbeat", "micro_reflection", "dream_cycle", "wakeup_call"]);
export const cycleStateSchema = z.enum(["scheduled", "claimed", "running", "completed", "partially_completed", "failed", "uncertain"]);
export const autonomyCycleSchema = z.object({
  id, ...scope, type: cycleTypeSchema, state: cycleStateSchema, scheduledAt: timestamp,
  startedAt: timestamp.optional(), finishedAt: timestamp.optional(), timezone: z.string().min(1).max(100),
  leaseOwner: id.optional(), leaseTokenDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), leaseExpiresAt: timestamp.optional(),
  triggerReason: z.string().min(1).max(200), cycleVersion: z.string().min(1).max(50), traceId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
  effectBearing: z.boolean(), armsAttempted: z.array(z.object({ name: id, status: z.enum(["completed", "failed", "paused", "deferred"]), failureType: z.string().max(100).optional() }).strict()).max(100),
  evidenceRefs, modelUsageIds: z.array(id).max(100).default([]), estimatedCostUsd: z.number().nonnegative(), observedCostUsd: z.number().nonnegative().optional(),
  outcome: z.string().min(1).max(200), nextScheduledWake: timestamp.optional(), recoveryOfCycleId: id.optional(), recoveredAt: timestamp.optional(),
}).strict();
export type AutonomyCycle = z.infer<typeof autonomyCycleSchema>;

export const evidenceProvenanceSchema = z.enum(["verified_live", "fixture", "recorded_replay", "mock", "synthetic", "unverified"]);
export const observationSchema = z.object({
  id, ...scope, sourceRecordId: id, observationType: id, provenance: evidenceProvenanceSchema,
  verified: z.boolean(), authorized: z.boolean(), observedAt: timestamp,
  facts: z.record(z.string().min(1).max(100), jsonScalar).refine((value) => Object.keys(value).length <= 50, "too many observation facts"),
  traceId: z.string().regex(/^[a-f0-9]{32}$/).optional(),
}).strict();
export type Observation = z.infer<typeof observationSchema>;

export const reflectionSchema = z.object({ id, ...scope, cycleId: id, evidenceRefs: evidenceRefs.min(1), scope: z.string().min(1).max(200), summary: z.string().min(1).max(4000), confidence: z.number().min(0).max(1), expiresAt: timestamp, expectedBenefit: z.string().max(1000), riskClass: z.enum(["low", "medium", "high"]), estimatedCostUsd: z.number().nonnegative(), evaluationCriteria: z.string().max(2000) }).strict();
export const hypothesisSchema = z.object({ id, ...scope, reflectionId: id, evidenceRefs: evidenceRefs.min(1), statement: z.string().min(1).max(2000), confidence: z.number().min(0).max(1), expiresAt: timestamp, contradictionRefs: evidenceRefs }).strict();

export const experimentVariableSchema = z.enum(["preferred_posting_hour", "content_format_weight", "topic_fatigue_threshold", "retry_backoff_seconds", "approved_template_preference"]);
export const experimentSchema = z.object({
  id, ...scope, hypothesisId: id, variable: experimentVariableSchema, baseline: jsonScalar, candidate: jsonScalar,
  lowerBound: z.number().optional(), upperBound: z.number().optional(), evidenceThreshold: z.number().int().positive(),
  evaluationMethod: z.enum(["holdout", "before_after"]), successCriteria: z.string().min(1).max(2000), failureCriteria: z.string().min(1).max(2000),
  maximumCostUsd: z.number().nonnegative(), startsAt: timestamp, endsAt: timestamp, expiresAt: timestamp, rollbackCondition: z.string().min(1).max(2000),
  state: z.enum(["candidate", "active", "evaluating", "promoted", "rejected", "expired", "rolled_back"]),
}).strict();
export type Experiment = z.infer<typeof experimentSchema>;

export const configurationRevisionSchema = z.object({
  id, ...scope, category: id, previousValue: jsonScalar, newValue: jsonScalar, evidenceRefs: evidenceRefs.min(1), confidence: z.number().min(0).max(1),
  policyResult: z.enum(["approved", "rejected", "human_required"]), traceId: z.string().regex(/^[a-f0-9]{32}$/), createdAt: timestamp,
  state: z.enum(["proposed", "applied", "rolled_back", "rejected"]), rollbackRevisionId: id.optional(), rollbackReason: z.string().max(1000).optional(),
}).strict().superRefine((revision, context) => { if ((revision.state === "applied" || revision.state === "rolled_back") && !revision.rollbackRevisionId) context.addIssue({ code: "custom", path: ["rollbackRevisionId"], message: "applied revisions require a rollback revision pointer" }); });
export type ConfigurationRevision = z.infer<typeof configurationRevisionSchema>;

export const agendaAuthoritySchema = z.enum(["execute", "auto_tune", "propose", "request_attention"]);
export const agendaItemSchema = z.object({ id, ...scope, agendaId: id, idempotencyKey: z.string().regex(/^[a-f0-9]{64}$/), title: z.string().min(1).max(500), evidenceRefs: evidenceRefs.min(1), estimatedCostUsd: z.number().nonnegative(), deadline: timestamp, risk: z.enum(["low", "medium", "high"]), authority: agendaAuthoritySchema, state: z.enum(["pending", "claimed", "completed", "failed", "deferred", "uncertain"]), terminalRecordId: id.optional() }).strict();
export const agendaSchema = z.object({ id, ...scope, cycleId: id, scheduledFor: timestamp, briefing: z.string().min(1).max(8000), itemIds: z.array(id).max(200), state: z.enum(["scheduled", "active", "completed", "partially_completed", "failed"]), createdAt: timestamp }).strict();
export const attentionRequestSchema = z.object({ id, ...scope, cycleId: id.optional(), agendaItemId: id.optional(), reason: z.string().min(1).max(2000), failureType: z.enum(["transient_provider", "permanent_provider", "policy_rejection", "authorization", "budget_exhaustion", "insufficient_evidence", "integrity", "uncertain_effect"]), state: z.enum(["open", "acknowledged", "resolved"]), createdAt: timestamp }).strict();
