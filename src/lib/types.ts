import type { ContentArtifact } from "./contentArtifacts/contracts";

export const STAGES = [
  "queued",
  "collect_sources",
  "extract_sources",
  "awaiting_source_resolution",
  "understand",
  "strategize",
  "awaiting_strategy_approval",
  "plan",
  "draft",
  "awaiting_approval",
  "publish",
  "verify",
  "learn",
  "complete",
  "failed",
] as const;

export type Stage = (typeof STAGES)[number];

export type JobStatus =
  | "running"
  | "waiting_for_approval"
  | "complete"
  | "failed";

export type SourceInput =
  | { kind: "youtube"; url: string; rightsAuthorizationId: string }
  | { kind: "web"; url: string; rightsAuthorizationId: string }
  | { kind: "upload"; attachmentId: string; rightsAuthorizationId: string }
  | { kind: "pasted_text"; title: string; text: string; rightsAuthorizationId: string };

export type SourceState =
  | "discovered"
  | "validating"
  | "queued"
  | "extracting"
  | "ready"
  | "failed"
  | "excluded";

export interface SourceFailure {
  code: string;
  category: "validation" | "authorization" | "policy" | "provider_transient" | "provider_permanent" | "dependency";
  publicMessage: string;
  retryable: boolean;
  occurredAt: string;
}

export interface SourceRecord {
  id: string;
  workspaceId: string;
  brandId: string;
  provider: "youtube" | "web" | "upload" | "pasted_text" | "google_drive" | "gcs";
  providerResourceId: string;
  providerVersion: string;
  title: string;
  mimeType: string;
  state: SourceState;
  rightsAuthorizationId: string;
  trust: "operator_supplied" | "authorized_private" | "public_untrusted";
  contentDigest?: string;
  normalizedArtifactId?: string;
  extractionReceiptId?: string;
  failure?: SourceFailure;
  createdAt: string;
  updatedAt: string;
}

export type EvidenceLocator =
  | { kind: "time_range"; startMs: number; endMs: number }
  | { kind: "frame"; timestampMs: number; frameArtifactId: string }
  | { kind: "page_range"; startPage: number; endPage: number }
  | { kind: "paragraph_range"; startParagraph: number; endParagraph: number }
  | { kind: "line_range"; startLine: number; endLine: number }
  | { kind: "section"; heading: string; occurrence: number }
  | { kind: "url_fragment"; canonicalUrl: string; fragment: string };

export interface ContentSegment {
  id: string;
  text: string;
  locator: EvidenceLocator;
  digest: string;
}

export interface NormalizedSource {
  sourceId: string;
  sourceKind: "video" | "audio" | "document" | "web" | "text";
  title: string;
  mimeType: string;
  contentDigest: string;
  extractorVersion: string;
  extractedAt: string;
  segments: ContentSegment[];
  metadata: Record<string, string | number | boolean>;
  extractionReceiptId: string;
}

export interface SourceExclusionRecord {
  sourceId: string;
  reason: string;
  excludedAt: string;
  excludedBySubjectId: string;
}

export interface JobSourceManifest {
  id: string;
  jobId: string;
  revision: number;
  librarySnapshotId?: string;
  directSourceIds: string[];
  excludedSourceIds: string[];
  exclusionRecords: SourceExclusionRecord[];
  digest: string;
  sealedAt: string;
  sealedBySubjectId: string;
}

export type OutputKind =
  | "x_post" | "x_thread" | "linkedin_post" | "blog_article" | "newsletter" | "caption"
  | "carousel_spec" | "social_image" | "quote_card" | "diagram"
  | "short_clip" | "reel" | "generated_video" | "generated_music" | "editorial_calendar" | "content_pack";

export interface ProposedOutput { id: string; outputType: OutputKind; quantity: number; destinations: string[]; evidenceRefs: string[]; costClass: "local" | "provider_metered"; approvalClass: "strategy" | "effect" }
export interface CampaignOutputPlan { id: string; desiredOutputs: OutputKind[]; allowedOutputs: OutputKind[]; outputs: ProposedOutput[]; digest: string }

export interface JobConfig {
  operatorBrief?: string;
  sourceManifestId: string;
  desiredOutputs: OutputKind[];
  allowedOutputs: OutputKind[];
  strategyContext?: StrategyContext;
  analysisResearchRequest?: AnalysisResearchRequest;
  platforms: string[];
}

export interface AnalysisResearchRequest {
  id: string;
  question: string;
  justification: string;
}

export interface AnalysisSearchEvidence {
  evidenceId: string;
  supportedText: string;
  title: string;
  url: string;
}

export interface StrategyContext {
  company: string; product: string; positioning: string;
  differentiators: string[]; brandVoice: string[]; exclusions: string[]; safetyConstraints: string[];
  businessObjectives: string[]; campaignObjectives: string[];
  audiences: Array<{ id: string; name: string; pains: string[] }>;
  funnelStage: "awareness" | "consideration" | "conversion" | "retention" | "advocacy";
  intendedConversion: string; requestedChannels: string[]; supportedChannels: string[];
  horizonWeeks?: number;
  researchRequest?: StrategyResearchRequest;
}

export interface StrategyResearchRequest { id: string; question: string; justification: string }
export interface StrategySearchEvidence { evidenceId: string; supportedText: string; title: string; url: string }

export interface ContentStrategy {
  strategyId: string; version: number; horizonWeeks: number; thesis: string; differentiatedNarrative: string;
  objectives: Array<{ text: string; evidenceRefs: string[] }>;
  audiencePriorities: Array<{ audienceId: string; priority: number; reason: string; evidenceRefs: string[] }>;
  funnelIntent: StrategyContext["funnelStage"]; intendedConversions: string[];
  pillars: Array<{ name: string; purpose: string; evidenceRefs: string[] }>;
  campaignThemes: Array<{ name: string; message: string; evidenceRefs: string[] }>;
  channelRoles: Array<{ channel: string; role: string; operationallySupported: boolean; formats: string[]; cadence: string; evidenceRefs: string[] }>;
  contentMix: Array<{ format: string; percentage: number }>;
  cadenceGuidance: string; priorityRules: string[]; ctaGuidance: string[];
  kpis: Array<{ name: string; target: string; measurement: string; evidenceRefs: string[] }>;
  successCriteria: string[]; constraints: string[]; exclusions: string[]; brandSafety: string[];
  briefs: Array<{ id: string; title: string; objective: string; audienceId: string; funnelStage: StrategyContext["funnelStage"]; keyMessage: string; channelCandidates: string[]; formatCandidates: string[]; ctaIntent: string; intendedConversion: string; kpi: string; priority: number; dependencies: string[]; constraints: string[]; evidenceRefs: string[] }>;
  assumptions: Array<{ text: string; evidenceRefs: string[]; confidence: "low" | "medium" | "high" }>;
  confidence: "low" | "medium" | "high";
}

export interface StrategyApproval {
  decision: "approved" | "rejected"; payloadDigest: string; revision: number;
  actorSubjectId: string; decidedAt: string; expiresAt: string; feedback?: string;
}

export interface EditorialPlannerInput {
  strategy: ContentStrategy;
  strategyDigest: string;
  strategyVersion: number;
  strategyApproval: StrategyApproval & { decision: "approved" };
  analysis: SourceAnalysis;
  planningSnapshot: EditorialPlanningSnapshot;
  planningSnapshotDigest: string;
  revision: number;
  replanningFeedback?: string;
}

export interface EditorialPlanItem {
  id: string;
  briefId: string;
  campaignTheme: string;
  contentPillar: string;
  objective: string;
  audienceId: string;
  funnelStage: StrategyContext["funnelStage"];
  intendedConversion: string;
  ctaIntent: string;
  kpi: string;
  channel: string;
  format: string;
  evidenceRefs: string[];
  publicationWindowStartAt: string;
  publicationWindowEndAt: string;
  productionDeadlineAt: string;
  priority: number;
  selectionScore: number;
  dependencies: string[];
  productionStatus: "planned";
  constraints: string[];
  requiredAssets: string[];
  planningRationale: string;
  selectionRationale: string;
  confidence: "low" | "medium" | "high";
}

export interface EditorialPlan {
  planId: string;
  version: number;
  approvedStrategyDigest: string;
  planningSnapshotId: string;
  planningSnapshotDigest: string;
  horizonStartAt: string;
  horizonEndAt: string;
  timezone: string;
  summary: string;
  sequencingRationale: string;
  cadenceRationale: string;
  assumptions: string[];
  confidence: "low" | "medium" | "high";
  items: EditorialPlanItem[];
  selectedNextItemId: string;
}

export interface EditorialPlanningSnapshot {
  snapshotId: string;
  asOf: string;
  horizonStartAt: string;
  horizonEndAt: string;
  timezone: string;
  channelCapabilities: Array<{ channel: string; formats: string[] }>;
  existingCommitments: Array<{ id: string; channel: string; publicationWindowStartAt: string; publicationWindowEndAt: string }>;
  productionCapacity: { maxItems: number; maxItemsPerWeek: number };
  cadenceConstraints: { minimumHoursBetweenItems: number; maxItemsPerChannelPerWeek: number };
  postingWindowObservations: Array<{ id: string; channel: string; format: string; observedAt: string; evidenceRefs: string[] }>;
  assetReadiness: Array<{ id: string; briefId: string; assetType: string; status: "ready" | "missing" | "blocked"; evidenceRefs: string[] }>;
  blockedDependencies: Array<{ id: string; briefId: string; reason: string; evidenceRefs: string[] }>;
  calendarProjection: Array<{ id: string; contentItemId: string; state: "not_projected" | "synced" | "update_required" | "removed" | "failed"; externalEventId?: string; evidenceRefs: string[] }>;
  provenanceIds: string[];
}

export interface StrategyInvocationContext {
  revision: number; sourceIds: string[]; operatorContextIds: string[];
  performance: Array<{ id: string; firestoreEvidenceRef: string }>;
  memoryFacts: Array<{ id: string; firestoreEvidenceRef: string }>;
  audienceIds: string[]; requestedChannels: string[]; supportedChannels: string[]; horizonWeeks: number;
  researchRequest: StrategyResearchRequest | null;
  searchEvidence: StrategySearchEvidence[];
  searchProvenance?: import("./searchProvenance").SearchProvenance | null;
}

export interface Job {
  id: string;
  workspaceId: string;
  brandId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
  status: JobStatus;
  terminalOutcome?: "succeeded" | "partial" | "failed" | "unresolved" | "rejected";
  retentionDeleteAfter?: string;
  retentionHold?: boolean;
  stage: Stage;
  config: JobConfig;
  controlEpoch: number;
  controlState: "running" | "paused" | "cancelled";
  steeringInstructions?: Array<{ nudgeId: string; scope: "current_stage" | "remaining_job" | "content_item"; contentItemId?: string; instruction: string; appliedAt: string; controlEpoch: number }>;
  campaignOutputPlan?: CampaignOutputPlan;
  contentArtifacts?: ContentArtifact[];
  artifactProductionResult?: import("./contentArtifacts/submission").ArtifactProductionResult;
  sourceAnalysis?: SourceAnalysis;
  analysisDigest?: string;
  analysisResearchRequest?: AnalysisResearchRequest | null;
  analysisSearchEvidence?: AnalysisSearchEvidence[];
  analysisSearchProvenance?: import("./searchProvenance").SearchProvenance | null;
  contentStrategy?: ContentStrategy;
  strategyDigest?: string;
  strategyRevision?: number;
  strategyApprovalState?: "pending" | "approved" | "rejected";
  strategyApproval?: StrategyApproval;
  strategyApprovalExpiresAt?: string;
  strategyRevisionFeedback?: string;
  strategyEvidenceLineage?: string[];
  strategyHistory?: Record<string, { strategy: ContentStrategy; digest: string; revision: number; evidenceLineage: string[]; invocationContext: StrategyInvocationContext; proposedAt: string; expiresAt: string; approval?: StrategyApproval }>;
  strategyInvocationContext?: StrategyInvocationContext;
  editorialPlan?: EditorialPlan;
  editorialPlanningSnapshot?: EditorialPlanningSnapshot;
  editorialPlanningSnapshotDigest?: string;
  editorialPlanningSnapshotHistory?: Record<string, { snapshot: EditorialPlanningSnapshot; digest: string; revision: number; capturedAt: string }>;
  editorialPlanDigest?: string;
  editorialPlanRevision?: number;
  editorialPlanEvidenceLineage?: string[];
  selectedNextItemId?: string;
  editorialItemStates?: Record<string, { status: "planned" | "selected" | "drafting" | "reviewed" | "awaiting_approval"; updatedAt: string }>;
  activeProductionLineage?: { editorialPlanId: string; editorialPlanDigest: string; editorialItemId: string; briefId: string };
  artifactProductionDigest?: string;
  editorialPlanHistory?: Record<string, { plan: EditorialPlan; digest: string; revision: number; strategyId: string; strategyDigest: string; evidenceLineage: string[]; selectedNextItemId: string; acceptedAt: string }>;
  budget?: JobBudget;
  failure?: {
    stage: Stage;
    category: "validation" | "authorization" | "policy" | "budget" | "provider_transient" | "provider_permanent" | "dependency" | "protocol";
    code: string;
    publicMessage: string;
    retryable: boolean;
    operationId: string;
    traceId: string;
    attempt: number;
    maxAttempts: number;
    details: Record<string, string | number | boolean>;
    at: string;
  };
}

export interface JobBudget {
  estimatedUsd: string;
  observedUsd: string;
  reservedUsd: string;
  limitUsd: string;
  approvalThresholdUsd: string;
}

export interface UsageRecord {
  id: string;
  jobId: string;
  operationId: string;
  stage: string;
  role: string;
  model: string;
  inputUnits: number;
  outputUnits: number;
  unitType: "tokens" | "images" | "video_seconds" | "audio_seconds" | "endpoint_seconds" | "media_generations";
  estimatedCostUsd: string;
  observedCostUsd?: string;
  pricingVersion: string;
  modelPolicy?: ModelPolicySnapshot;
  traceId: string;
  createdAt: string;
}

export interface ModelPolicySnapshot {
  policyVersion: string;
  pricingVersion: string;
  temperature: number | null;
  topP: number | null;
  topK: number | null;
  safetyProfile: string;
  maxOutputTokens: number;
  timeoutSeconds: number;
  eligibleTasks: string[];
  minimumPassRate: string;
}

export interface EvidenceRef {
  kind:
    | "youtube_api"
    | "media_file"
    | "gemini_call"
    | "x_api"
    | "linkedin_api"
    | "http_probe"
    | "firestore_doc"
    | "asset_store";
  url: string;
  fetchedAt: string;
  digest?: string | null;
}

export type RiskLevel = "low" | "medium" | "high";

export type ActionType =
  | "export_content_artifact"
  | "publish_x_post"
  | "publish_x_thread"
  | "publish_linkedin_post"
  | "generate_image"
  | "generate_video"
  | "generate_music"
  | "render_clip"
  | "render_reel";

export interface PlannedAction {
  id: string;
  jobId: string;
  type: ActionType;
  title: string;
  description: string;
  momentId?: string;
  angleId?: string;
  editorialPlanId?: string;
  editorialItemId?: string;
  briefId?: string;
  risk: RiskLevel;
  requiresApproval: boolean;
  approvalState: "not_required" | "pending" | "approved" | "rejected";
  payload: Record<string, unknown>;
  /** Server-computed when an action is presented for an approval decision. */
  payloadDigest?: string;
  state: "planned" | "executed" | "skipped" | "failed";
}

export interface ApprovalDecision {
  id: string;
  jobId: string;
  actionId: string;
  decision: "approved" | "rejected";
  payloadDigest: string;
  actorType: "firebase_operator" | "telegram_operator";
  actorSubjectId: string;
  authenticationId: string;
  channel: "dashboard" | "telegram";
  operationId: string;
  traceId: string;
  decidedAt: string;
}

export interface Receipt {
  id: string;
  jobId: string;
  actionId: string;
  idempotencyKey: string;
  actionType: ActionType;
  performedAt: string;
  outcome: "applied" | "already_applied" | "rejected" | "failed";
  artifact?: EvidenceRef;
  detail: Record<string, unknown>;
  operationId: string;
  traceId: string;
}

export interface ReplayObservation {
  id: string;
  jobId: string;
  actionId: string;
  operationId: string;
  traceId: string;
  receiptId: string;
  outcome: "already_applied";
  attemptedAt: string;
}

export interface EffectClaimInput {
  jobId: string;
  actionId: string;
  actionType: ActionType;
  idempotencyKey: string;
  operationId: string;
  traceId: string;
  claimToken: string;
}

export interface EffectClaim extends EffectClaimInput {
  id: string;
  state: "claimed" | "dispatched" | "observed" | "applied" | "failed" | "unknown";
  attempt: number;
  claimedAt: string;
  leaseExpiresAt: string;
  finalizedAt?: string;
  receiptId?: string;
  operationEpoch?: number;
  goalDigest?: string;
  dispatchedAt?: string;
  observedAt?: string;
  unknownReason?: string;
}

export type EffectClaimSummary = Pick<EffectClaim,
  "id" | "actionId" | "idempotencyKey" | "state" | "attempt" | "claimedAt" | "finalizedAt" | "receiptId" | "operationId" | "traceId"
>;

export type EffectClaimOutcome =
  | { outcome: "execute"; claim: EffectClaim }
  | { outcome: "in_progress"; claim: EffectClaim }
  | { outcome: "uncertain"; claim: EffectClaim }
  | { outcome: "already_applied"; claim: EffectClaim; receiptId: string }
  | { outcome: "paused" | "cancelled" };

export interface VerificationResult {
  id: string;
  target: string;
  actionId: string;
  receiptId: string;
  operationId: string;
  traceId: string;
  verified: boolean;
  method: "artifact_digest_reread" | "official_api_readback";
  evidence: EvidenceRef;
  checkedAt: string;
  note?: string;
}

export interface StageEvent {
  id: string;
  jobId: string;
  at: string;
  stage: Stage;
  message: string;
  actor: "system" | "agent" | "operator";
  operationId: string;
  traceId: string;
  pubsubMessageId?: string;
  activity?: import("./contracts").AgentActivity;
}

export interface Observation {
  kind: "devpost_source" | "github_repo" | "github_file" | "cloud_run_url";
  target: string;
  url: string;
  ok: boolean;
  httpStatus?: number | null;
  digest?: string | null;
  excerpt?: string | null;
  detail: Record<string, unknown>;
}

export interface Moment {
  id: string;
  title: string;
  startSec: number;
  endSec: number;
  hook: string;
  quote: string;
  sourceSegmentRefs: string[];
  visualHook?: string;
  cropSuitability?: "poor" | "fair" | "good" | "excellent";
  captionSafeRegion?: string;
  visualEvidenceIds: string[];
  assumptions: string[];
  confidence: "low" | "medium" | "high";
}

export interface Angle {
  id: string;
  angleType: "source_insight" | "trend" | "meme" | "performance_learning" | "memory_learning";
  evidenceKind: "source" | "public_context" | "performance" | "memory";
  title: string;
  rationale: string;
  evidenceRefs: string[];
  assumptions: string[];
  confidence: "low" | "medium" | "high";
}

export interface SourceAnalysis {
  sourceDigest: string;
  summary: string;
  moments: Moment[];
  angles: Angle[];
  assumptions: string[];
  confidence: "low" | "medium" | "high";
}

export interface EvidencePacket {
  jobId: string;
  generatedAt: string;
  config: JobConfig;
  artifacts: Array<{ id: string; outputType: string; revision: number; contentDigest: string }>;
  verifications: VerificationResult[];
  unresolved: string[];
}

/** Reaction metrics captured for one published post during the learn stage. */
export interface Engagement {
  actionId: string;
  postId: string;
  url?: string;
  likes: number;
  replies: number;
  reposts: number;
  quotes: number;
  impressions?: number;
  checkedAt: string;
}

/** Deterministic takeaways fed back into future research/ideation prompts. */
export interface Learnings {
  summary: string;
  notes: string[];
  generatedAt: string;
}

export type ContentItemStatus =
  | "draft"
  | "scheduled"
  | "awaiting_final_review"
  | "publishing"
  | "published"
  | "failed"
  | "cancelled";

export type PublishMode = "auto" | "approval";

export interface ContentItemRevision {
  text: string;
  at: string;
}

export interface GoogleCalendarSync {
  status: "synced" | "update_required" | "removed" | "failed";
  calendarId: string;
  eventId: string;
  etag?: string;
  htmlLink?: string;
  sourceUpdatedAt?: string;
  verifiedAt?: string;
  lastAttemptAt?: string;
  failureReason?: string;
}

export interface ContentItem {
  id: string;
  jobId: string;
  draftId?: string;
  draftRevision?: 1 | 2;
  editorialPlanId?: string;
  editorialItemId?: string;
  briefId?: string;
  text: string;
  platforms: string[];
  status: ContentItemStatus;
  publishMode: PublishMode;
  scheduledFor?: string;
  effectCommandId?: string;
  revisions?: ContentItemRevision[];
  /** Rendered media attached to this post (image/clip action ids on the parent job). */
  assetActionIds?: string[];
  publishedPostId?: string;
  publishedUrl?: string;
  publishedAt?: string;
  failureReason?: string;
  googleCalendarSync?: GoogleCalendarSync;
  createdAt: string;
  updatedAt: string;
}

export type NotificationSeverity = "info" | "warning" | "critical";

export interface AppNotification {
  id?: string;
  kind: string;
  title: string;
  body: string;
  severity: NotificationSeverity;
  refType?: "job" | "content_item" | "connection";
  refId?: string;
  href?: string;
  readAt?: string | null;
  createdAt: string;
}
