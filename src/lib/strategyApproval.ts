import { createHash } from "node:crypto";
import { assertSourcesInSearchProvenance, type SearchProvenance } from "./searchProvenance";
import type { ContentStrategy, JobConfig, SourceAnalysis, StrategyInvocationContext, StrategySearchEvidence } from "./types";

export function strategySourceEvidenceIds(analysis: SourceAnalysis): string[] {
  return [...new Set([
    ...analysis.moments.flatMap((moment) => [moment.id, ...moment.sourceSegmentRefs]),
    ...analysis.angles.flatMap((angle) => [angle.id, ...angle.evidenceRefs]),
  ])].sort();
}

export function validateStrategySearchGrounding(
  request: StrategyInvocationContext["researchRequest"], evidence: StrategySearchEvidence[], provenance: SearchProvenance | null,
): void {
  if (!request) {
    if (evidence.length || provenance) throw new Error("strategy search requires an exact research request");
    return;
  }
  if (!evidence.length || !provenance) throw new Error("requested strategy research requires grounded search evidence");
  assertSourcesInSearchProvenance(evidence, provenance, "strategy");
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

export function strategyDigest(strategy: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonical(strategy)), "utf8").digest("hex");
}

export function validatePersistedStrategy(job: { config: JobConfig; sourceAnalysis?: SourceAnalysis; strategyInvocationContext?: StrategyInvocationContext }, strategy: ContentStrategy): void {
  const context = job.config.strategyContext;
  if (!context) throw new Error("typed strategy context required");
  const invocation = job.strategyInvocationContext;
  if (!invocation || invocation.revision !== strategy.version) throw new Error("persisted strategy invocation context required");
  if (strategy.horizonWeeks !== (context.horizonWeeks ?? 4)) throw new Error("strategy horizon mismatch");
  if (!job.sourceAnalysis) throw new Error("persisted source analysis required");
  const sourceIds = new Set(strategySourceEvidenceIds(job.sourceAnalysis));
  const audienceIds = new Set(context.audiences.map((item) => item.id));
  const requested = new Set(context.requestedChannels);
  const supported = new Set(context.supportedChannels);
  const references = [
    ...strategy.objectives, ...strategy.audiencePriorities, ...strategy.pillars,
    ...strategy.campaignThemes, ...strategy.channelRoles, ...strategy.kpis,
    ...strategy.briefs, ...strategy.assumptions,
  ].flatMap((item) => item.evidenceRefs);
  const exactEvidenceIds = new Set([
    ...invocation.sourceIds, ...invocation.operatorContextIds,
    ...invocation.performance.map((item) => item.id), ...invocation.memoryFacts.map((item) => item.id),
    ...invocation.searchEvidence.map((item) => item.evidenceId),
  ]);
  const invalidRefs = references.filter((ref) => !exactEvidenceIds.has(ref));
  if (invalidRefs.length) throw new Error(`unknown persisted evidence references: ${[...new Set(invalidRefs)].join(", ")}`);
  for (const role of strategy.channelRoles) {
    if (!requested.has(role.channel)) throw new Error(`unrequested strategy channel: ${role.channel}`);
    if (role.operationallySupported !== supported.has(role.channel)) throw new Error(`incorrect channel support: ${role.channel}`);
  }
  for (const brief of strategy.briefs) {
    if (!audienceIds.has(brief.audienceId)) throw new Error(`unknown strategy audience: ${brief.audienceId}`);
    if (!brief.evidenceRefs.some((ref) => sourceIds.has(ref))) throw new Error(`brief ${brief.id} lacks source evidence`);
    if (brief.channelCandidates.some((channel) => !requested.has(channel))) throw new Error(`brief ${brief.id} has unrequested channel`);
  }
}

export type StrategyDecisionInput = { decision: "approved" | "rejected"; payloadDigest: string; feedback?: string };

export function assertStrategyProposalRevision(stage: string, persistedRevision: number | undefined, submittedRevision: number, strategyVersion: number): void {
  if (stage !== "strategize") throw new Error(`job stage is '${stage}'`);
  const expected = persistedRevision ?? 1;
  if (submittedRevision !== expected || strategyVersion !== expected) throw new Error("stale strategy revision");
}

export function applyStrategyDecision(
  current: { revision: number; strategyDigest: string; approvalExpiresAt: string },
  input: StrategyDecisionInput,
  actorSubjectId: string,
  now: Date,
) {
  if (input.payloadDigest !== current.strategyDigest) throw new Error("strategy payload changed");
  if (now.getTime() > new Date(current.approvalExpiresAt).getTime()) throw new Error("strategy approval expired");
  if (input.decision === "rejected" && !input.feedback?.trim()) throw new Error("strategy rejection feedback required");
  const approval = {
    decision: input.decision, payloadDigest: input.payloadDigest, revision: current.revision,
    actorSubjectId, decidedAt: now.toISOString(), expiresAt: current.approvalExpiresAt,
    ...(input.feedback?.trim() ? { feedback: input.feedback.trim() } : {}),
  };
  if (input.decision === "approved") return { approval, nextStage: "plan" as const };
  if (current.revision === 1) return { approval, nextStage: "strategize" as const, nextRevision: 2 as const };
  return { approval, nextStage: "complete" as const, terminalOutcome: "rejected" as const };
}
