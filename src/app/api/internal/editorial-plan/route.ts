import { editorialPlanSubmissionSchema } from "@/lib/contracts";
import { acceptEditorialPlan, appendEvent } from "@/lib/firestore";
import { editorialPlanDigest } from "@/lib/editorialPlan";
import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { dispatchStageOutboxRecord } from "@/lib/stageOutboxDispatcher";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, editorialPlanSubmissionSchema, async (body) => {
    const digest = editorialPlanDigest(body.plan);
    try {
      const accepted = await acceptEditorialPlan(body.jobId, body.plan, body.revision);
      const message = `Temi editorial plan ${digest} persisted; selected ${accepted.selectedNextItemId}`;
      await appendEvent(body.jobId, "plan", message, "agent", { activity: {
        kind: "handoff", status: "succeeded", role: "temi_editorial_planner",
        fromRole: "temi_editorial_planner", toRole: "noni_copywriter", publicMessage: message,
      } });
      try { await dispatchStageOutboxRecord(accepted.outboxId); } catch { /* durable tick retries */ }
      return Response.json({ ok: true, digest, selectedNextItemId: accepted.selectedNextItemId, triggered: "draft" });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
    }
  });
}
