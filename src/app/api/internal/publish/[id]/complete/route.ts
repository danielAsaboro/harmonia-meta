import { getJob, transitionStageWithOutbox } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";
import { dispatchStageOutboxRecord } from "@/lib/stageOutboxDispatcher";

/**
 * Completes the act stage when the worker finished executing all approved
 * actions (including the degenerate zero-action case).
 */
async function post(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  if (body?.stage !== "publish") {
    return Response.json({ error: "expected stage 'publish'" }, { status: 400 });
  }
  const job = await getJob(id);
  if (job.stage !== "publish") {
    return Response.json({ error: `job stage is '${job.stage}'` }, { status: 409 });
  }
  const outstanding = job.actions.filter((a) => a.state === "planned");
  if (outstanding.length > 0) {
    return Response.json(
      { error: `${outstanding.length} action(s) still unreported` },
      { status: 409 },
    );
  }
  const outboxId = await transitionStageWithOutbox(id, "publish", "verify", "action phase complete");
  try { await dispatchStageOutboxRecord(outboxId); } catch { /* durable tick retries */ }
  return Response.json({ ok: true });
}

export const POST = internalTenantHandler(post);
