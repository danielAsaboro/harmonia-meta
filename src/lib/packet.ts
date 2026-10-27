import type {
  EvidencePacket,
  PlannedAction,
  Receipt,
  VerificationResult,
} from "./types";
import type { ContentArtifact } from "./contentArtifacts/contracts";

export interface PacketInputs {
  jobId: string;
  config: EvidencePacket["config"];
  artifacts: ContentArtifact[];
  actions: PlannedAction[];
  receipts: Receipt[];
  verifications: VerificationResult[];
}

/**
 * Assembles the final content evidence packet. A publish is "verified" only
 * when an independent re-fetch confirmed it; everything else stays listed as
 * an unresolved gap.
 */
export function assemblePacket(inputs: PacketInputs): EvidencePacket {
  const unresolved: string[] = [];

  for (const action of inputs.actions) {
    if (action.approvalState === "pending") {
      unresolved.push(`approval still pending: ${action.title}`);
    }
    if (action.approvalState === "rejected" && action.state === "skipped") {
      unresolved.push(`operator rejected action: ${action.title}`);
    }
    if (action.state === "failed") {
      unresolved.push(`action failed: ${action.title}`);
    }
    if (action.state === "executed") {
      const receipt = inputs.receipts.find((candidate) => candidate.actionId === action.id);
      if (!receipt) unresolved.push(`executed action has no receipt: ${action.title}`);
      const verification = inputs.verifications.find((candidate) => candidate.actionId === action.id);
      if (!verification) unresolved.push(`executed action has no verification: ${action.title}`);
    }
  }

  for (const v of inputs.verifications) {
    if (!v.verified) unresolved.push(`not verified: ${v.target} (${v.note ?? v.method})`);
  }

  if (inputs.receipts.length === 0 && inputs.actions.length > 0 && !inputs.actions.some((action) => action.state === "executed")) {
    unresolved.push("no publish receipts recorded");
  }

  return {
    jobId: inputs.jobId,
    generatedAt: new Date().toISOString(),
    config: inputs.config,
    artifacts: inputs.artifacts.map(({ id, outputType, revision, contentDigest }) => ({ id, outputType, revision, contentDigest })),
    verifications: inputs.verifications,
    unresolved,
  };
}
