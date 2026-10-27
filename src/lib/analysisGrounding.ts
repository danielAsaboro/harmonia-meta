import { assertSourcesInSearchProvenance, type SearchProvenance } from "./searchProvenance";
import type { AnalysisResearchRequest, AnalysisSearchEvidence } from "./types";

export function validateAnalysisSearchGrounding(
  request: AnalysisResearchRequest | null,
  evidence: AnalysisSearchEvidence[],
  provenance: SearchProvenance | null,
): void {
  if (!request) {
    if (evidence.length || provenance) throw new Error("analysis search requires an exact research request");
    return;
  }
  if (!evidence.length || !provenance) throw new Error("requested analysis research requires grounded evidence");
  assertSourcesInSearchProvenance(evidence, provenance, "analysis");
}
