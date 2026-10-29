import { z } from "zod";
import { operatorTenantHandler } from "@/lib/auth";
import { appendEvent, decideStrategy } from "@/lib/firestore";
import { dispatchStageOutboxRecord } from "@/lib/stageOutboxDispatcher";

const schema = z.object({
  decision: z.enum(["approved", "rejected"]),
  payloadDigest: z.string().regex(/^[a-f0-9]{64}$/),
  feedback: z.string().min(1).max(2000).optional(),
}).strict();

async function post(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid strategy decision" }, { status: 400 });
  try {
    const result = await decideStrategy(id, parsed.data);
    await appendEvent(id, "awaiting_strategy_approval", result.approval.decision === "approved" ? "operator approved Ryan strategy" : "operator rejected Ryan strategy", "operator");
    if (result.outboxId) {
      try { await dispatchStageOutboxRecord(result.outboxId); } catch { /* durable dispatcher retries */ }
    }
    return Response.json({ ok: true, nextStage: result.nextStage, terminalOutcome: result.terminalOutcome });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message.includes("awaiting") ? 409 : 400 });
  }
}

export const POST = operatorTenantHandler(post);
