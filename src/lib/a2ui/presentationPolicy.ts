import type {
  NodeArtDirection,
  SurfaceComponentName,
} from "./presentationContracts";

export type ArtDirectedComponentName =
  | SurfaceComponentName
  | "SurfaceLoading"
  | "SurfaceEmpty"
  | "SurfaceUnresolved"
  | "SurfaceFailure";

export interface PresentationLifecycle {
  failed?: boolean;
  verified?: boolean;
  approvalPending?: boolean;
  highRisk?: boolean;
}

interface ResolveArtDirectionInput {
  component: ArtDirectedComponentName;
  requested?: NodeArtDirection;
  lifecycle?: PresentationLifecycle;
}

const DEFAULTS: Record<ArtDirectedComponentName, NodeArtDirection> = {
  CampaignBrief: { tone: "ink", role: "hero", density: "airy", motion: "reveal" },
  JobProgress: { tone: "ink", role: "strip", density: "compact", motion: "pulse" },
  MomentExplorer: { tone: "blue", role: "feature", density: "balanced", motion: "trace" },
  DraftComparison: { tone: "violet", role: "feature", density: "balanced", motion: "reveal" },
  PlatformPreview: { tone: "blue", role: "support", density: "balanced", motion: "reveal" },
  SourceEvidence: { tone: "paper", role: "support", density: "compact", motion: "none" },
  ApprovalReview: { tone: "coral", role: "feature", density: "balanced", motion: "reveal" },
  VerificationReceipt: { tone: "acid", role: "feature", density: "balanced", motion: "reveal" },
  SurfaceLoading: { tone: "ink", role: "strip", density: "compact", motion: "pulse" },
  SurfaceEmpty: { tone: "paper", role: "inline", density: "compact", motion: "none" },
  SurfaceUnresolved: { tone: "coral", role: "inline", density: "compact", motion: "none" },
  SurfaceFailure: { tone: "coral", role: "feature", density: "balanced", motion: "none" },
};

const ALLOWED_TONES: Record<ArtDirectedComponentName, ReadonlySet<NodeArtDirection["tone"]>> = {
  CampaignBrief: new Set(["paper", "ink", "violet"]),
  JobProgress: new Set(["paper", "ink", "blue", "coral"]),
  MomentExplorer: new Set(["paper", "ink", "blue", "violet"]),
  DraftComparison: new Set(["paper", "ink", "acid", "blue", "violet"]),
  PlatformPreview: new Set(["paper", "ink", "acid", "blue", "violet"]),
  SourceEvidence: new Set(["paper", "ink", "blue"]),
  ApprovalReview: new Set(["paper", "ink", "coral"]),
  VerificationReceipt: new Set(["paper", "ink", "acid", "coral"]),
  SurfaceLoading: new Set(["paper", "ink", "blue", "violet"]),
  SurfaceEmpty: new Set(["paper", "ink"]),
  SurfaceUnresolved: new Set(["paper", "coral"]),
  SurfaceFailure: new Set(["paper", "coral"]),
};

export function resolveNodeArtDirection({
  component,
  requested,
  lifecycle = {},
}: ResolveArtDirectionInput): NodeArtDirection {
  const fallback = DEFAULTS[component];
  const candidate = { ...fallback, ...requested };
  const resolved = {
    ...candidate,
    tone: ALLOWED_TONES[component].has(candidate.tone) ? candidate.tone : fallback.tone,
  };

  if (component === "SurfaceUnresolved" || component === "SurfaceFailure" || lifecycle.failed) {
    return { ...resolved, tone: "coral", motion: "none" };
  }
  if (component === "VerificationReceipt" && !lifecycle.verified) {
    return { ...resolved, tone: "paper", motion: "none" };
  }
  if (component === "ApprovalReview" && lifecycle.approvalPending) {
    return { ...resolved, tone: lifecycle.highRisk ? "coral" : "ink" };
  }
  return resolved;
}
