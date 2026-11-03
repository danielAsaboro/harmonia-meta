import { analysisSubmissionSchema } from "@/lib/contracts";
import { appendEvent, getJob, saveAnalysis, saveCampaignOutputPlan } from "@/lib/firestore";
import { proposeOutputPlan } from "@/lib/outputPlanning";
import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { advance } from "@/lib/advance";
import { sourceAnalysisDigest } from "@/lib/sourceAnalysis";
import { validateAnalysisSearchGrounding } from "@/lib/analysisGrounding";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, analysisSubmissionSchema, async (body) => {
    if (sourceAnalysisDigest(body.analysis) !== body.analysisDigest) {
      throw new Error("source analysis digest mismatch");
    }
    validateAnalysisSearchGrounding(body.researchRequest, body.searchEvidence, body.searchProvenance);
    await saveAnalysis(
      body.jobId, body.analysis, body.analysisDigest,
      body.researchRequest, body.searchEvidence, body.searchProvenance,
    );
    const screen = body.sourceScreen;
    if (screen && (screen.quarantined.length || screen.strippedCharacters)) {
      const rules = [...new Set(screen.quarantined.map((item) => item.rule))].join(", ");
      const screenedBy = screen.modelScreen.startsWith("glimmer:") ? `rules and ${screen.modelScreen.slice(8)}` : "rules";
      await appendEvent(body.jobId, "understand",
        `source screen (${screenedBy}): withheld ${screen.quarantined.length} of ${screen.screenedSegments} segment(s) from the agents`
        + (rules ? ` (${rules})` : "")
        + (screen.strippedCharacters ? `; removed ${screen.strippedCharacters} invisible character(s)` : ""),
        "system");
    }
    const job = await getJob(body.jobId);
    await saveCampaignOutputPlan(body.jobId, proposeOutputPlan(body.jobId, job.config.desiredOutputs, job.config.allowedOutputs, body.analysis));
    const message = `analysis: ${body.analysis.moments.length} grounded moment(s), ${body.analysis.angles.length} grounded angle(s), with ${body.modelUsed}`;
    await appendEvent(body.jobId, "understand", message, "agent", { activity: {
      kind: "handoff", status: "succeeded", role: "nimi_analyst",
      fromRole: "nimi_analyst", toRole: "ryan_strategist", publicMessage: message,
    } });
    return advance(body.jobId, "understand", "analysis complete; Ryan strategy dispatched");
  });
}
