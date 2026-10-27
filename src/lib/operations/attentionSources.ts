import type { AttentionKind, AttentionSource } from "./attention";

interface AttentionJob {
  id: string;
  stage: string;
  status: string;
  updatedAt: string;
  config: { platforms: string[] };
  strategyApprovalState?: "pending" | "approved" | "rejected";
  actions?: Array<{ id: string; title: string; state: string; approvalState?: string }>;
  failure?: { category: string; code: string; publicMessage: string; at: string };
  editorialPlanningSnapshot?: {
    assetReadiness?: Array<{ id: string; status: string; assetType: string; briefId?: string }>;
  };
}

interface UnknownEffect {
  jobId: string;
  operationId: string;
  commandId: string;
  reason: string;
  dispatchedAt?: string;
}

interface ResidentAttention {
  id: string;
  state: "open" | "acknowledged" | "resolved";
  failureType: string;
  reason: string;
  createdAt: string;
  jobId?: string;
}

export interface AttentionSourcesInput {
  workspaceId: string;
  brandId: string;
  jobs: AttentionJob[];
  connectedPlatforms: string[];
  unknownEffects: UnknownEffect[];
  residentAttention: ResidentAttention[];
}

function source(
  input: AttentionSourcesInput,
  value: Omit<AttentionSource, "workspaceId" | "brandId">,
): AttentionSource {
  return { workspaceId: input.workspaceId, brandId: input.brandId, ...value };
}

function residentKind(failureType: string): AttentionKind {
  if (failureType === "budget_exhaustion") return "budget_required";
  if (failureType === "authorization") return "credential_required";
  if (failureType === "uncertain_effect") return "uncertain_effect";
  if (["policy_rejection", "integrity", "insufficient_evidence"].includes(failureType)) return "policy_block";
  return "failed_stage";
}

/** Compiles durable system records into a single operator-attention vocabulary. */
export function buildAttentionSources(input: AttentionSourcesInput): AttentionSource[] {
  const sources: AttentionSource[] = [];
  const connected = new Set(input.connectedPlatforms);

  for (const job of input.jobs) {
    if (job.status === "complete") continue;
    for (const action of job.actions ?? []) {
      if (action.approvalState !== "pending") continue;
      sources.push(source(input, {
        kind: "approval", sourceId: action.id, jobId: job.id, state: "open",
        title: action.title, reason: "This action is waiting for operator approval.", createdAt: job.updatedAt,
      }));
    }
    if (job.strategyApprovalState === "pending") {
      sources.push(source(input, {
        kind: "strategy_decision", sourceId: `${job.id}:strategy`, jobId: job.id, state: "open",
        title: "Review content strategy", reason: "The proposed strategy must be approved before production continues.", createdAt: job.updatedAt,
      }));
    }
    if (job.failure) {
      sources.push(source(input, {
        kind: job.failure.category === "policy" ? "policy_block" : "failed_stage",
        sourceId: `${job.id}:${job.failure.code}`, jobId: job.id, state: "open",
        title: job.failure.category === "policy" ? "Policy decision required" : "Job stage failed",
        reason: job.failure.publicMessage, createdAt: job.failure.at,
      }));
    }
    for (const asset of job.editorialPlanningSnapshot?.assetReadiness ?? []) {
      if (asset.status !== "missing") continue;
      sources.push(source(input, {
        kind: "missing_asset", sourceId: `${job.id}:${asset.id}`, jobId: job.id, state: "open",
        title: `Missing ${asset.assetType} asset`, reason: "Production cannot continue until the required asset is supplied.", createdAt: job.updatedAt,
      }));
    }
    for (const platform of job.config.platforms) {
      if (connected.has(platform)) continue;
      sources.push(source(input, {
        kind: "credential_required", sourceId: `${job.id}:${platform}`, jobId: job.id, state: "open",
        title: `Connect ${platform}`, reason: `This job requests ${platform}, but no active connection is configured.`, createdAt: job.updatedAt,
      }));
    }
  }

  for (const effect of input.unknownEffects) {
    sources.push(source(input, {
      kind: "uncertain_effect", sourceId: effect.commandId, jobId: effect.jobId, state: "open",
      title: "External outcome is uncertain", reason: effect.reason,
      createdAt: effect.dispatchedAt ?? new Date(0).toISOString(),
    }));
  }
  for (const request of input.residentAttention) {
    sources.push(source(input, {
      kind: residentKind(request.failureType), sourceId: request.id, ...(request.jobId ? { jobId: request.jobId } : {}),
      state: request.state, title: "Resident agent needs attention", reason: request.reason, createdAt: request.createdAt,
    }));
  }
  return sources;
}
