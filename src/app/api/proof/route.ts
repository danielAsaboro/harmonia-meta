import { concurrentGroups, loadBrandBrief, loadGroundingEval, loadMetaStatus, loadNarratedVideo, loadProbeReport, loadPublicRuns, loadRoster, loadScreenEval } from "@/lib/proof";

export const dynamic = "force-dynamic";

// Public and read-only: each request re-verifies every bundle's integrity and
// terminal-state digest, and re-reads Meta status and the agent roster.
export async function GET() {
  const [metaStatus, probe, roster, publicRuns, sourceScreenEval, brandBrief, narratedVideo, groundingEval] = await Promise.all([
    loadMetaStatus(), loadProbeReport(), loadRoster(), loadPublicRuns(), loadScreenEval(), loadBrandBrief(), loadNarratedVideo(), loadGroundingEval(),
  ]);
  return Response.json({
    metaStatus, probe, roster, sourceScreenEval, brandBrief, narratedVideo, groundingEval, ...publicRuns,
    concurrentRuns: concurrentGroups(publicRuns.runs), generatedAt: new Date().toISOString(),
  });
}
