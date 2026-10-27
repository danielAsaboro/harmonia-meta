import { createHash } from "node:crypto";
import type { CampaignOutputPlan, NormalizedSource, OutputKind, ProposedOutput, SourceAnalysis } from "./types";
import { OUTPUT_CAPABILITIES } from "./outputCapabilities";

export interface OutputEligibilityIssue { outputType: OutputKind; code: "not_allowed" | "video_evidence_required" | "missing_evidence"; message: string }

export function validateOutputEligibility(plan: Pick<CampaignOutputPlan, "allowedOutputs" | "outputs">, sources: NormalizedSource[]): OutputEligibilityIssue[] {
  const allowed = new Set(plan.allowedOutputs); const refs = new Set(sources.flatMap((source) => source.segments.map((segment) => `${source.sourceId}:${segment.id}`)));
  const hasVideoTimeRange = sources.some((source) => source.sourceKind === "video" && source.segments.some((segment) => segment.locator.kind === "time_range"));
  const issues: OutputEligibilityIssue[] = [];
  for (const output of plan.outputs) {
    if (!allowed.has(output.outputType)) issues.push({ outputType: output.outputType, code: "not_allowed", message: "output is outside operator-allowed types" });
    if (["short_clip", "reel"].includes(output.outputType) && !hasVideoTimeRange) issues.push({ outputType: output.outputType, code: "video_evidence_required", message: "source clips require real video time-range evidence" });
    if (!output.evidenceRefs.length || output.evidenceRefs.some((reference) => !refs.has(reference))) issues.push({ outputType: output.outputType, code: "missing_evidence", message: "output evidence does not resolve to the normalized manifest" });
  }
  return issues;
}

export function sealOutputPlan(input: Omit<CampaignOutputPlan, "digest">): CampaignOutputPlan {
  const canonical = { ...input, desiredOutputs: [...input.desiredOutputs].sort(), allowedOutputs: [...input.allowedOutputs].sort(), outputs: [...input.outputs].sort((a, b) => a.id.localeCompare(b.id)) };
  return { ...input, digest: createHash("sha256").update(JSON.stringify(canonical)).digest("hex") };
}

export function proposeOutputPlan(jobId: string, desiredOutputs: OutputKind[], allowedOutputs: OutputKind[], analysis: SourceAnalysis): CampaignOutputPlan {
  const unavailable = desiredOutputs.filter((output) => OUTPUT_CAPABILITIES[output].state === "unavailable");
  if (unavailable.length) throw new Error(`unavailable output: ${unavailable.join(", ")}`);
  const allowed = new Set(allowedOutputs); const sourceRefs = [...new Set([...analysis.moments.flatMap((moment) => moment.sourceSegmentRefs), ...analysis.angles.flatMap((angle) => angle.evidenceKind === "source" ? angle.evidenceRefs.filter((ref) => ref.includes(":")) : [])])];
  const timedRefs = [...new Set(analysis.moments.flatMap((moment) => moment.sourceSegmentRefs))];
  const outputs: ProposedOutput[] = desiredOutputs.filter((outputType) => allowed.has(outputType)).flatMap((outputType, index) => {
    const clip = outputType === "short_clip" || outputType === "reel"; const evidenceRefs = clip ? timedRefs : sourceRefs;
    if (!evidenceRefs.length) return [];
    const capability = OUTPUT_CAPABILITIES[outputType];
    return [{ id: `output-${index + 1}-${outputType}`, outputType, quantity: 1, destinations: capability.publisher ? [capability.publisher] : [], evidenceRefs, costClass: capability.costClass, approvalClass: capability.approvalClass }];
  });
  return sealOutputPlan({ id: `output-plan-${jobId}`, desiredOutputs, allowedOutputs, outputs });
}

export function planOutputProjection(
  jobId: string,
  existing: CampaignOutputPlan | undefined,
  desiredOutputs: OutputKind[],
  allowedOutputs: OutputKind[],
  analysis: SourceAnalysis,
): { outcome: "existing" | "reconstructed"; plan: CampaignOutputPlan } {
  if (existing) return { outcome: "existing", plan: existing };
  return {
    outcome: "reconstructed",
    plan: proposeOutputPlan(jobId, desiredOutputs, allowedOutputs, analysis),
  };
}
