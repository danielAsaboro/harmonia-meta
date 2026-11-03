import type { AnalysisResearchRequest, AnalysisSearchEvidence, ApprovalDecision, CampaignOutputPlan, EvidenceRef, Angle, ContentStrategy, EditorialPlan, EditorialPlanningSnapshot, EffectClaimSummary, Job, JobConfig, JobSourceManifest, Moment, NormalizedSource, PlannedAction, Receipt, SourceAnalysis, SourceRecord, Stage, StrategyApproval } from "@/lib/types";
import type { ContentArtifact } from "@/lib/contentArtifacts/contracts";

export interface JobSummary {
  id: string;
  status: string;
  stage: Stage;
  createdAt: string;
  updatedAt: string;
  config: JobConfig;
  sourceAnalysis?: SourceAnalysis;
  controlEpoch?: number;
  controlState?: "running" | "paused" | "cancelled";
  failure?: Job["failure"];
  learnings?: { summary: string; notes: string[] };
}

export interface JobFull extends JobSummary {
  campaignOutputPlan?: CampaignOutputPlan;
  contentStrategy?: ContentStrategy;
  strategyDigest?: string;
  strategyRevision?: number;
  strategyApprovalState?: "pending" | "approved" | "rejected";
  strategyApproval?: StrategyApproval;
  strategyApprovalExpiresAt?: string;
  strategyEvidenceLineage?: string[];
  editorialPlan?: EditorialPlan;
  editorialPlanDigest?: string;
  editorialPlanRevision?: number;
  editorialPlanEvidenceLineage?: string[];
  editorialPlanningSnapshot?: EditorialPlanningSnapshot;
  editorialPlanningSnapshotDigest?: string;
  selectedNextItemId?: string;
  editorialItemStates?: Record<string, { status: "planned" | "selected" | "drafting" | "reviewed" | "awaiting_approval"; updatedAt: string }>;
  sourceManifest?: JobSourceManifest;
  sourceRecords?: SourceRecord[];
  normalizedSources?: NormalizedSource[];
  analysisDigest?: string;
  analysisResearchRequest?: AnalysisResearchRequest | null;
  analysisSearchEvidence?: AnalysisSearchEvidence[];
  analysisSearchProvenance?: import("@/lib/searchProvenance").SearchProvenance | null;
  contentArtifacts?: ContentArtifact[];
  actions: PlannedAction[];
  engagement?: Array<{
    actionId: string;
    postId: string;
    url?: string;
    likes: number;
    replies: number;
    reposts: number;
    quotes: number;
    impressions?: number;
    checkedAt: string;
  }>;
  learnings?: { summary: string; notes: string[] };
  verifications?: Array<{
    id?: string;
    rubricItemId: string;
    actionId?: string;
    receiptId?: string;
    operationId?: string;
    traceId?: string;
    checkedAt?: string;
    verified: boolean;
    method: string;
    evidence: Pick<EvidenceRef, "url" | "digest"> & { fetchedAt: string };
    note?: string;
  }>;
  packet?: {
    generatedAt: string;
    unresolved: string[];
    receipts: Receipt[];
  };
  assets?: Array<{ actionId: string; mime: string; sizeBytes: number; digest: string }>;
  claims?: EffectClaimSummary[];
  decisions?: ApprovalDecision[];
}

export type { Angle, Moment, PlannedAction, Receipt, Stage };
