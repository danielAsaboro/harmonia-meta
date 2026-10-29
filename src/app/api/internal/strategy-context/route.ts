import { strategyInvocationContextSchema } from "@/lib/contracts";
import { saveStrategyInvocationContext } from "@/lib/firestore";
import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, strategyInvocationContextSchema, async ({ jobId, stage: _stage, ...context }) => {
    try {
      await saveStrategyInvocationContext(jobId, context);
      return Response.json({ ok: true });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
    }
  });
}
