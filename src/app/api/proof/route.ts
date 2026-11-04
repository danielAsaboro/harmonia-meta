import { loadMetaStatus, loadProbeReport, loadPublicRuns, loadRoster, loadScreenEval } from "@/lib/proof";

export const dynamic = "force-dynamic";

// Public and read-only: each request re-verifies every bundle's integrity and
// terminal-state digest, and re-reads Meta status and the agent roster.
export async function GET() {
  const [metaStatus, probe, roster, publicRuns, sourceScreenEval] = await Promise.all([loadMetaStatus(), loadProbeReport(), loadRoster(), loadPublicRuns(), loadScreenEval()]);
  return Response.json({ metaStatus, probe, roster, sourceScreenEval, ...publicRuns, generatedAt: new Date().toISOString() });
}
