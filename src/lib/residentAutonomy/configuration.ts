import { configurationRevisionSchema, type ConfigurationRevision } from "./contracts";
import { validateAutoTuneCandidate } from "./policy";

export interface ActiveAutonomyConfiguration { revisionId: string; workspaceId: string; brandId: string; category: string; value: unknown }
export function promoteConfiguration(current: ActiveAutonomyConfiguration, input: { expectedRevisionId: string; revisionId: string; candidateValue: unknown; evidenceRefs: string[]; confidence: number; traceId: string; at: string }): { config: ActiveAutonomyConfiguration; revision: ConfigurationRevision } {
  if (current.revisionId !== input.expectedRevisionId) throw new Error("configuration revision conflict");
  const policy = validateAutoTuneCandidate({ category: current.category, currentValue: current.value, candidateValue: input.candidateValue });
  if (policy.decision !== "auto_tune") throw new Error(`configuration promotion denied: ${policy.reason}`);
  const revision = configurationRevisionSchema.parse({ id: input.revisionId, workspaceId: current.workspaceId, brandId: current.brandId, category: current.category, previousValue: current.value, newValue: input.candidateValue, evidenceRefs: input.evidenceRefs, confidence: input.confidence, policyResult: "approved", traceId: input.traceId, createdAt: input.at, state: "applied", rollbackRevisionId: current.revisionId });
  return { config: { ...current, revisionId: input.revisionId, value: input.candidateValue }, revision };
}
export function rollbackConfiguration(current: ActiveAutonomyConfiguration, input: { appliedRevisionId: string; rollbackRevisionId: string; rollbackValue: unknown; recordId: string; reason: string; evidenceRefs: string[]; traceId: string; at: string }): { config: ActiveAutonomyConfiguration; revision: ConfigurationRevision } {
  if (current.revisionId !== input.appliedRevisionId) throw new Error("configuration rollback conflict");
  const revision = configurationRevisionSchema.parse({ id: input.recordId, workspaceId: current.workspaceId, brandId: current.brandId, category: current.category, previousValue: current.value, newValue: input.rollbackValue, evidenceRefs: input.evidenceRefs, confidence: 1, policyResult: "approved", traceId: input.traceId, createdAt: input.at, state: "rolled_back", rollbackRevisionId: input.rollbackRevisionId, rollbackReason: input.reason });
  return { config: { ...current, revisionId: input.rollbackRevisionId, value: input.rollbackValue }, revision };
}
