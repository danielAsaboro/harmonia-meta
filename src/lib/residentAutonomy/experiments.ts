import { experimentSchema, type Experiment, type Observation } from "./contracts";
import { eligibleEvolutionEvidence, validateAutoTuneCandidate } from "./policy";

export type ExperimentEvaluation =
  | { decision: "promote"; causalConfidence: "strong_holdout" | "weak_before_after"; eligibleSampleSize: number }
  | { decision: "reject" | "defer"; reason: string; eligibleSampleSize: number }
  | { decision: "expire"; eligibleSampleSize: number };
export function evaluateExperiment(input: Experiment, observations: Observation[], context: { baselineMetric: number; candidateMetric: number; unresolvedContradictions: boolean; budgetAvailable: boolean; now?: string }): ExperimentEvaluation {
  const experiment = experimentSchema.parse(input); const eligible = observations.filter(eligibleEvolutionEvidence);
  if (Date.parse(context.now ?? new Date().toISOString()) > Date.parse(experiment.expiresAt)) return { decision: "expire", eligibleSampleSize: eligible.length };
  if (eligible.length < experiment.evidenceThreshold) return { decision: "defer", reason: "insufficient_evidence", eligibleSampleSize: eligible.length };
  if (context.unresolvedContradictions) return { decision: "defer", reason: "unresolved_contradiction", eligibleSampleSize: eligible.length };
  if (!context.budgetAvailable) return { decision: "defer", reason: "budget_exhaustion", eligibleSampleSize: eligible.length };
  const policy = validateAutoTuneCandidate({ category: experiment.variable, currentValue: experiment.baseline, candidateValue: experiment.candidate });
  if (policy.decision !== "auto_tune") return { decision: "reject", reason: "policy_rejection", eligibleSampleSize: eligible.length };
  if (!(context.candidateMetric > context.baselineMetric)) return { decision: "reject", reason: "success_criteria_not_met", eligibleSampleSize: eligible.length };
  return { decision: "promote", causalConfidence: experiment.evaluationMethod === "holdout" ? "strong_holdout" : "weak_before_after", eligibleSampleSize: eligible.length };
}
