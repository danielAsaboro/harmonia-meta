import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { applyStepProgress, onboardingProgressSchema, updateOnboardingRun } from "@/lib/onboardingRuns";

/** The agent reports each website onboarding step as it starts and finishes. */
export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, onboardingProgressSchema, async ({ runId, ...progress }) => {
    const run = await updateOnboardingRun(runId, (current) => applyStepProgress(current, progress));
    if (!run) return Response.json({ error: "onboarding run not found" }, { status: 404 });
    return Response.json({ ok: true });
  });
}
