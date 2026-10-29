import { z } from "zod";
import { appendEvent, getJob, saveCampaignOutputPlan } from "@/lib/firestore";
import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { planOutputProjection } from "@/lib/outputPlanning";

const schema = z.object({ jobId: z.string().min(1) }).strict();

export async function POST(request: Request) {
  if (!isInternalAuthorized(request)) return unauthorized();
  return internalRoute(request, schema, async ({ jobId }) => {
    const job = await getJob(jobId);
    if (!job.sourceAnalysis) throw new Error("source analysis required for output-plan recovery");
    const result = planOutputProjection(
      jobId,
      job.campaignOutputPlan,
      job.config.desiredOutputs,
      job.config.allowedOutputs ?? job.config.desiredOutputs,
      job.sourceAnalysis,
    );
    if (result.outcome === "reconstructed") {
      await saveCampaignOutputPlan(jobId, result.plan);
      await appendEvent(
        jobId,
        job.stage,
        "Harmonia reconstructed the missing derived campaign output plan from persisted job authority.",
        "system",
        { activity: {
          kind: "retry", status: "succeeded", role: "coordinator_system",
          code: "missing_output_plan_reconstructed", category: "protocol",
          publicMessage: "Recovered the missing campaign output plan without changing strategy or approval authority.",
        } },
      );
    }
    return Response.json(result);
  });
}
