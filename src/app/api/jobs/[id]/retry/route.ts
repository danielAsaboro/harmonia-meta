import { z } from "zod";
import { appendEvent, getJob, retryFailedJobWithOutbox } from "@/lib/firestore";
import { administratorTenantHandler } from "@/lib/auth";
import { dispatchStageOutboxRecord } from "@/lib/stageOutboxDispatcher";
import { isKnownStage } from "@/lib/stages";
import { authorizeJobRetry } from "@/lib/jobRetry";
import { INTERNAL_CONTRACT_REVISION } from "@/lib/internalHandler";

const retrySchema = z.object({ afterFix: z.literal(true).optional() }).strict();

/**
 * Re-dispatches a permanently failed job from the stage it failed at.
 * Handlers overwrite their stage's data safely, and executed actions are
 * skipped by state, so retries cannot duplicate external effects.
 */
async function post(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = retrySchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return Response.json({ error: "invalid retry request" }, { status: 400 });

  const job = await getJob(id);
  if (!job.failure || (job.status !== "failed" && !job.failure.retryable)) {
    return Response.json(
      { error: "only failed jobs can be retried", status: job.status },
      { status: 409 },
    );
  }
  let retryAuthorization: ReturnType<typeof authorizeJobRetry>;
  try {
    retryAuthorization = authorizeJobRetry(job.failure, parsed.data.afterFix === true, INTERNAL_CONTRACT_REVISION);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
  }
  const failedStage = job.failure.stage;
  if (!isKnownStage(failedStage) || failedStage === "complete" || failedStage === "failed") {
    return Response.json(
      { error: `stage '${failedStage}' is not retryable` },
      { status: 409 },
    );
  }

  const outboxId = await retryFailedJobWithOutbox(id, failedStage, retryAuthorization);
  await appendEvent(
    id,
    failedStage,
    retryAuthorization.allowPermanent
      ? `administrator resumed stage '${failedStage}' after acknowledging a deployed fix`
      : `operator requested retry from stage '${failedStage}'`,
    "operator",
  );
  try { await dispatchStageOutboxRecord(outboxId); } catch { /* durable tick retries */ }
  return Response.json({ ok: true, retriedFrom: failedStage });
}

export const POST = administratorTenantHandler(post);
