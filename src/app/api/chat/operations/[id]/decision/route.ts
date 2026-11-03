import { z } from "zod";
import { operatorTenantHandler } from "@/lib/auth";
import { decidePendingOperation, getPendingOperation } from "@/lib/pendingOperations";
import { resolveDecision } from "@/lib/decisions";
import { decideStrategy } from "@/lib/firestore";
import { dispatchStageOutboxRecord } from "@/lib/stageOutboxDispatcher";

const decisionSchema = z.object({ decision: z.enum(["approved", "rejected"]) }).strict();

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = decisionSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid operation decision" }, { status: 400 });
  try {
    const pending = await getPendingOperation(id);
    if (!pending) throw new Error("operation not found");
    const operation = await decidePendingOperation(id, parsed.data.decision);
    if (operation.handler === "decide_strategy") {
      const { jobId, payloadDigest } = operation.arguments;
      if (typeof jobId !== "string" || typeof payloadDigest !== "string") throw new Error("operation is not strategy-bound");
      const outcome = await decideStrategy(jobId, { decision: parsed.data.decision, payloadDigest });
      if (outcome.outboxId) { try { await dispatchStageOutboxRecord(outcome.outboxId); } catch { /* durable dispatcher retries */ } }
      return Response.json({ operation, outcome });
    }
    if (operation.handler !== "decide_job_action") return Response.json({ operation });
    const { jobId, actionId, payloadDigest } = operation.arguments;
    if (typeof jobId !== "string" || typeof actionId !== "string" || typeof payloadDigest !== "string") {
      throw new Error("operation is not payload-bound");
    }
    const outcome = await resolveDecision(jobId, actionId, parsed.data.decision, payloadDigest);
    return Response.json({ operation, outcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("not found") ? 404 : message.includes("expired") || message.includes("already") ? 409 : 400;
    return Response.json({ error: message }, { status });
  }
}

export const POST = operatorTenantHandler(post);
