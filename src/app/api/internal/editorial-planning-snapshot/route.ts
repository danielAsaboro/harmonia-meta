import { getOrCreateEditorialPlanningSnapshot } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized, withInternalTenant } from "@/lib/internalAuth";

export async function GET(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  const jobId = new URL(req.url).searchParams.get("jobId");
  if (!jobId) return Response.json({ error: "jobId is required" }, { status: 400 });
  return withInternalTenant(req, async () => {
    try {
      return Response.json(await getOrCreateEditorialPlanningSnapshot(jobId));
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
    }
  });
}
