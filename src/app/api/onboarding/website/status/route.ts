import { operatorTenantHandler } from "@/lib/auth";
import { getGoals } from "@/lib/firestore";
import { latestOnboardingRun } from "@/lib/onboardingRuns";

async function get(_req: Request) {
  const [run, goals] = await Promise.all([latestOnboardingRun(), getGoals()]);
  return Response.json({ run, brandBrief: run?.status === "done" ? goals.brandBrief ?? null : null });
}

export const GET = operatorTenantHandler(get);
