import { z } from "zod";

const REQUIRED_STAGES = [
  "collect_sources",
  "extract_sources",
  "understand",
  "draft",
  "awaiting_approval",
  "publish",
  "verify",
] as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const traceId = z.string().regex(/^[a-f0-9]{32}$/);
const timestamp = z.string().datetime({ offset: true });
const usd = z.string().regex(/^\d+\.\d{6}$/);

const sourceSchema = z.object({
  kind: z.literal("source_manifest"),
  manifestId: z.string().min(1),
  sourceIds: z.array(z.string().min(1)).min(1),
  manifestDigest: sha256,
}).strict();

const environmentSchema = z.object({
  projectId: z.string().min(1),
  location: z.string().min(1),
  webService: z.string().min(1),
  webRevision: z.string().min(1),
  agentService: z.string().min(1),
  agentRevision: z.string().min(1),
  agentEngineResource: z.string().min(1),
  firestoreDatabase: z.string().min(1),
  pubsubTopic: z.string().min(1),
  mockAi: z.boolean(),
  mockEffects: z.boolean(),
  emulator: z.boolean(),
}).strict();

const jobSchema = z.object({
  workspaceId: z.string().min(1),
  brandId: z.string().min(1),
  jobId: z.string().min(1),
  createdAt: timestamp,
  completedAt: timestamp,
}).strict();

const metricsSchema = z.object({
  sourceCount: z.number().int().positive(),
  elapsedSec: z.number().int().nonnegative(),
  handsOffProcessingSec: z.number().int().nonnegative(),
  approvalWaitSec: z.number().int().nonnegative(),
  operatorActionCount: z.number().int().nonnegative(),
  outputCount: z.number().int().positive(),
  approvedOutputCount: z.number().int().nonnegative(),
  verifiedOutputCount: z.number().int().nonnegative(),
}).strict();

const eventSchema = z.object({
  eventId: z.string().min(1),
  stage: z.enum(REQUIRED_STAGES),
  status: z.enum(["waiting", "completed"]),
  at: timestamp,
  operationId: z.string().min(1),
  pubsubMessageId: z.string().min(1).optional(),
  traceId,
}).strict();

const cognitionSchema = z.object({
  role: z.string().min(1),
  model: z.string().min(1),
  provider: z.literal("gemini"),
  policyVersion: z.string().min(1),
  usageRecordId: z.string().min(1),
  operationId: z.string().min(1),
  traceId,
}).strict();

const approvalSchema = z.object({
  approvalId: z.string().min(1),
  actionId: z.string().min(1),
  decision: z.literal("approved"),
  actorType: z.enum(["firebase_operator", "telegram_operator"]),
  decidedAt: timestamp,
  traceId,
}).strict();

const claimSchema = z.object({
  claimId: sha256,
  actionId: z.string().min(1),
  idempotencyKey: sha256,
  state: z.literal("applied"),
  receiptId: z.string().min(1),
  attempt: z.number().int().positive(),
  claimedAt: timestamp,
  finalizedAt: timestamp,
  operationId: z.string().min(1),
  traceId,
}).strict();

const effectSchema = z.object({
  actionId: z.string().min(1),
  operationId: z.string().min(1),
  idempotencyKey: sha256,
  receiptId: z.string().min(1),
  kind: z.enum(["export_content_artifact", "publish_post"]),
  outcome: z.literal("applied"),
  executedAt: timestamp,
  artifactDigest: sha256,
  traceId,
}).strict();

const verificationSchema = z.object({
  verificationId: z.string().min(1),
  receiptId: z.string().min(1),
  operationId: z.string().min(1),
  method: z.enum(["artifact_digest_reread", "official_api_readback"]),
  status: z.enum(["verified", "failed"]),
  checkedAt: timestamp,
  observedDigest: sha256,
  traceId,
}).strict();

const replaySchema = z.object({
  operationId: z.string().min(1),
  receiptId: z.string().min(1),
  outcome: z.enum(["already_applied", "applied"]),
  attemptedAt: timestamp,
  traceId,
}).strict();

const costRecordSchema = z.object({
  usageRecordId: z.string().min(1),
  operationId: z.string().min(1),
  estimatedUsd: usd,
  observedUsd: usd,
}).strict();

const costsSchema = z.object({
  pricingVersion: z.string().min(1),
  currency: z.literal("USD"),
  records: z.array(costRecordSchema),
  totalEstimatedUsd: usd,
  totalObservedUsd: usd,
}).strict();

const evidenceFileSchema = z.object({
  kind: z.enum(["job_export", "trace_export", "approval_export", "effect_export"]),
  relativePath: z.string().min(1),
  sha256,
}).strict();

export const verticalSliceEvidenceSchema = z.object({
  schemaVersion: z.literal("harmonia.vertical-slice-evidence.v1"),
  runId: z.string().min(1),
  capturedAt: timestamp,
  source: sourceSchema,
  environment: environmentSchema,
  job: jobSchema,
  metrics: metricsSchema,
  events: z.array(eventSchema),
  cognition: z.array(cognitionSchema).min(1),
  approval: approvalSchema,
  claim: claimSchema,
  effect: effectSchema,
  verification: verificationSchema,
  replay: replaySchema,
  costs: costsSchema,
  evidenceFiles: z.array(evidenceFileSchema).min(1),
}).strict();

export type VerticalSliceEvidence = z.infer<typeof verticalSliceEvidenceSchema>;

export type EvidenceFailure = {
  code: string;
  path: string;
  message: string;
};

export type EvidenceVerification = {
  ok: boolean;
  failures: EvidenceFailure[];
};

function failure(code: string, path: string, message: string): EvidenceFailure {
  return { code, path, message };
}

function decimalToMicros(value: string): bigint {
  const [whole, fractional] = value.split(".");
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fractional);
}

export function verifyVerticalSliceEvidence(input: unknown): EvidenceVerification {
  if (input && typeof input === "object") {
    const candidate = input as { executionMode?: unknown; evidenceClassification?: unknown };
    const replayClassifications = new Set(["fixture", "recorded_replay", "historical_replay"]);
    if (replayClassifications.has(String(candidate.executionMode)) || replayClassifications.has(String(candidate.evidenceClassification))) {
      return { ok: false, failures: [failure("replay_not_fresh_evidence", "executionMode", "Fixtures and recorded replays cannot be accepted as fresh authenticated provider or deployment evidence.")] };
    }
  }
  const parsed = verticalSliceEvidenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      failures: parsed.error.issues.map((issue) => failure(
        "schema_invalid",
        issue.path.join("."),
        issue.message,
      )),
    };
  }

  const bundle = parsed.data;
  const failures: EvidenceFailure[] = [];

  const elapsedFromTimestamps = Math.round(
    (Date.parse(bundle.job.completedAt) - Date.parse(bundle.job.createdAt)) / 1000,
  );
  if (
    bundle.metrics.elapsedSec !== elapsedFromTimestamps
    || bundle.metrics.handsOffProcessingSec + bundle.metrics.approvalWaitSec !== bundle.metrics.elapsedSec
  ) {
    failures.push(failure(
      "elapsed_time_mismatch",
      "metrics",
      "Elapsed time must match job timestamps and equal hands-off processing plus approval wait.",
    ));
  }
  if (bundle.metrics.approvedOutputCount > bundle.metrics.outputCount) {
    failures.push(failure(
      "approved_output_overflow",
      "metrics.approvedOutputCount",
      "Approved outputs cannot exceed total outputs.",
    ));
  }
  if (bundle.metrics.verifiedOutputCount > bundle.metrics.approvedOutputCount) {
    failures.push(failure(
      "verified_output_overflow",
      "metrics.verifiedOutputCount",
      "Verified outputs cannot exceed approved outputs.",
    ));
  }
  if (bundle.metrics.operatorActionCount < 1) {
    failures.push(failure(
      "missing_operator_action",
      "metrics.operatorActionCount",
      "The approval-gated demonstrated slice requires at least one operator action.",
    ));
  }
  if (bundle.metrics.approvedOutputCount < 1 || bundle.metrics.verifiedOutputCount < 1) {
    failures.push(failure(
      "missing_verified_output",
      "metrics",
      "The demonstrated slice requires at least one approved and independently verified output.",
    ));
  }

  if (bundle.environment.mockAi || bundle.environment.mockEffects || bundle.environment.emulator) {
    failures.push(failure(
      "non_production_provenance",
      "environment",
      "Authenticated evidence cannot originate from mocks or emulators.",
    ));
  }

  if (!/^projects\/[^/]+\/locations\/[^/]+\/reasoningEngines\/[^/]+$/.test(
    bundle.environment.agentEngineResource,
  )) {
    failures.push(failure(
      "missing_agent_engine",
      "environment.agentEngineResource",
      "A concrete Vertex AI Agent Engine resource is required.",
    ));
  }

  if (!bundle.cognition.every((entry) => /^gemini-3\.(?:[5-9]|\d{2,})(?:-|$)/.test(entry.model))) {
    failures.push(failure(
      "missing_required_gemini",
      "cognition",
      "Every cognition record must use Gemini 3.5 or newer.",
    ));
  }

  const presentStages = new Set(bundle.events.map((event) => event.stage));
  for (const stage of REQUIRED_STAGES) {
    if (!presentStages.has(stage)) {
      failures.push(failure("missing_stage", "events", `Missing required stage: ${stage}.`));
    }
  }

  const stageSequence = bundle.events.map((event) => event.stage);
  if (
    stageSequence.length !== REQUIRED_STAGES.length
    || stageSequence.some((stage, index) => stage !== REQUIRED_STAGES[index])
  ) {
    failures.push(failure(
      "stage_order_invalid",
      "events",
      "Evidence stages must appear exactly once in the required lifecycle order.",
    ));
  }

  for (let index = 1; index < bundle.events.length; index += 1) {
    if (Date.parse(bundle.events[index].at) < Date.parse(bundle.events[index - 1].at)) {
      failures.push(failure("stage_order_invalid", `events.${index}.at`, "Stage timestamps are not monotonic."));
      break;
    }
  }

  const traceRecords = [
    ...bundle.events.map((entry, index) => ({ path: `events.${index}.traceId`, value: entry.traceId })),
    ...bundle.cognition.map((entry, index) => ({ path: `cognition.${index}.traceId`, value: entry.traceId })),
    { path: "approval", value: bundle.approval.traceId },
    { path: "claim", value: bundle.claim.traceId },
    { path: "effect", value: bundle.effect.traceId },
    { path: "verification", value: bundle.verification.traceId },
    { path: "replay", value: bundle.replay.traceId },
  ];
  for (const record of traceRecords) {
    if (record.value === "0".repeat(32)) {
      failures.push(failure(
        "missing_trace_context",
        record.path,
        "Authenticated evidence requires a real OpenTelemetry trace context.",
      ));
    }
  }

  const eventTraceIds = new Set(bundle.events.map((entry) => entry.traceId));
  for (let index = 0; index < bundle.cognition.length; index += 1) {
    if (!eventTraceIds.has(bundle.cognition[index].traceId)) {
      failures.push(failure(
        "cognition_trace_unlinked",
        `cognition.${index}.traceId`,
        "Cognition must share trace context with a persisted lifecycle event.",
      ));
    }
  }
  if (bundle.approval.traceId !== bundle.effect.traceId) {
    failures.push(failure(
      "approval_effect_trace_mismatch",
      "effect.traceId",
      "The approved effect must descend from the operator approval trace.",
    ));
  }
  if (bundle.claim.actionId !== bundle.effect.actionId) {
    failures.push(failure("claim_action_mismatch", "claim.actionId", "Effect claim does not match the applied action."));
  }
  if (bundle.claim.receiptId !== bundle.effect.receiptId) {
    failures.push(failure("claim_receipt_mismatch", "claim.receiptId", "Effect claim does not reference the applied receipt."));
  }
  if (bundle.claim.claimId !== bundle.effect.idempotencyKey || bundle.claim.idempotencyKey !== bundle.effect.idempotencyKey) {
    failures.push(failure("claim_idempotency_mismatch", "claim.idempotencyKey", "Effect claim does not own the applied idempotency key."));
  }
  if (bundle.claim.operationId !== bundle.effect.operationId || bundle.claim.traceId !== bundle.effect.traceId) {
    failures.push(failure("claim_lineage_mismatch", "claim.operationId", "Effect receipt does not descend from its execution claim."));
  }
  if (Date.parse(bundle.claim.claimedAt) < Date.parse(bundle.approval.decidedAt)) {
    failures.push(failure("claim_before_approval", "claim.claimedAt", "Effect was claimed before human approval."));
  }
  if (Date.parse(bundle.claim.claimedAt) > Date.parse(bundle.effect.executedAt)) {
    failures.push(failure("claim_after_effect", "claim.claimedAt", "Effect was executed before its durable claim."));
  }
  if (Date.parse(bundle.claim.finalizedAt) < Date.parse(bundle.effect.executedAt)) {
    failures.push(failure("claim_finalized_before_effect", "claim.finalizedAt", "Effect claim finalized before effect execution."));
  }
  if (bundle.effect.traceId !== bundle.verification.traceId) {
    failures.push(failure(
      "effect_verification_trace_mismatch",
      "verification.traceId",
      "Verification must remain linked to the applied effect trace.",
    ));
  }
  if (bundle.replay.traceId === bundle.effect.traceId) {
    failures.push(failure(
      "replay_trace_reused",
      "replay.traceId",
      "Replay proof must come from a distinct traced attempt.",
    ));
  }

  const operationIds = bundle.events.map((event) => event.operationId);
  if (new Set(operationIds).size !== operationIds.length) {
    failures.push(failure("duplicate_operation_id", "events", "Event operation IDs must be unique."));
  }
  if (!bundle.events.some((event) => event.pubsubMessageId)) {
    failures.push(failure(
      "missing_pubsub_evidence",
      "events",
      "At least one lifecycle transition must retain its real Pub/Sub message ID.",
    ));
  }

  if (bundle.approval.actionId !== bundle.effect.actionId) {
    failures.push(failure("action_mismatch", "effect.actionId", "Effect does not match the approved action."));
  }
  if (Date.parse(bundle.effect.executedAt) < Date.parse(bundle.approval.decidedAt)) {
    failures.push(failure("effect_before_approval", "effect.executedAt", "Effect occurred before human approval."));
  }
  if (bundle.verification.receiptId !== bundle.effect.receiptId) {
    failures.push(failure("receipt_mismatch", "verification.receiptId", "Verification does not reference the effect receipt."));
  }
  if (bundle.verification.observedDigest !== bundle.effect.artifactDigest) {
    failures.push(failure("artifact_digest_mismatch", "verification.observedDigest", "Verified artifact differs from the applied artifact."));
  }
  if (bundle.verification.status !== "verified") {
    failures.push(failure("effect_not_verified", "verification.status", "The external effect was not independently verified."));
  }
  if (bundle.verification.operationId === bundle.effect.operationId) {
    failures.push(failure(
      "verification_operation_reused",
      "verification.operationId",
      "Verification requires its own operation identifier.",
    ));
  }
  if (Date.parse(bundle.verification.checkedAt) < Date.parse(bundle.effect.executedAt)) {
    failures.push(failure("verification_before_effect", "verification.checkedAt", "Verification occurred before effect execution."));
  }
  if (bundle.replay.receiptId !== bundle.effect.receiptId) {
    failures.push(failure("replay_receipt_mismatch", "replay.receiptId", "Replay did not reference the original effect receipt."));
  }
  if (bundle.replay.outcome !== "already_applied") {
    failures.push(failure("duplicate_effect_on_replay", "replay.outcome", "Replay did not stop at the existing idempotent receipt."));
  }
  if (Date.parse(bundle.replay.attemptedAt) < Date.parse(bundle.effect.executedAt)) {
    failures.push(failure("replay_before_effect", "replay.attemptedAt", "Replay evidence predates the original effect."));
  }
  if (bundle.replay.operationId === bundle.effect.operationId) {
    failures.push(failure("replay_operation_reused", "replay.operationId", "Replay observation requires its own operation identifier."));
  }

  const costsByUsage = new Map(bundle.costs.records.map((record) => [record.usageRecordId, record]));
  for (const cognition of bundle.cognition) {
    const cost = costsByUsage.get(cognition.usageRecordId);
    if (!cost || cost.operationId !== cognition.operationId) {
      failures.push(failure(
        "missing_usage_record",
        "costs.records",
        `No matching cost record exists for usage ${cognition.usageRecordId}.`,
      ));
    }
  }

  const estimated = bundle.costs.records.reduce(
    (sum, record) => sum + decimalToMicros(record.estimatedUsd),
    BigInt(0),
  );
  const observed = bundle.costs.records.reduce(
    (sum, record) => sum + decimalToMicros(record.observedUsd),
    BigInt(0),
  );
  if (
    estimated !== decimalToMicros(bundle.costs.totalEstimatedUsd)
    || observed !== decimalToMicros(bundle.costs.totalObservedUsd)
  ) {
    failures.push(failure(
      "cost_total_mismatch",
      "costs",
      "Declared cost totals do not exactly reconcile with usage records.",
    ));
  }

  return { ok: failures.length === 0, failures };
}
