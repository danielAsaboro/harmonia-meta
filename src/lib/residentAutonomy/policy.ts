import { observationSchema, type Observation } from "./contracts";

const protectedCategories = new Set(["prompt", "agent_instruction", "model_selection", "policy", "approval_requirement", "budget", "credential", "permission", "tool", "integration", "workflow_stage", "source_rights", "application_code", "infrastructure"]);
const numericBounds: Record<string, { min: number; max: number }> = {
  preferred_posting_hour: { min: 0, max: 23 }, content_format_weight: { min: 0, max: 1 },
  topic_fatigue_threshold: { min: 1, max: 20 }, retry_backoff_seconds: { min: 15, max: 300 },
};

export function eligibleEvolutionEvidence(input: Observation): boolean {
  const evidence = observationSchema.parse(input);
  return evidence.provenance === "verified_live" && evidence.verified && evidence.authorized;
}

export type AutoTuneCandidate = { category: string; currentValue: unknown; candidateValue: unknown };
export type AutoTuneDecision = { decision: "auto_tune" } | { decision: "propose"; reason: string } | { decision: "reject"; reason: string };
export function validateAutoTuneCandidate(input: AutoTuneCandidate): AutoTuneDecision {
  if (protectedCategories.has(input.category)) return { decision: "propose", reason: "protected configuration requires authenticated human approval" };
  if (input.category === "approved_template_preference") return typeof input.candidateValue === "string" && input.candidateValue.length > 0 ? { decision: "auto_tune" } : { decision: "reject", reason: "approved template preference must be a non-empty identifier" };
  const bounds = numericBounds[input.category];
  if (!bounds) return { decision: "propose", reason: "category is not approved for automatic tuning" };
  if (typeof input.candidateValue !== "number" || !Number.isFinite(input.candidateValue) || input.candidateValue < bounds.min || input.candidateValue > bounds.max) return { decision: "reject", reason: `candidate must be within ${bounds.min}..${bounds.max}` };
  return { decision: "auto_tune" };
}
