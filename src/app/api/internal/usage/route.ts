import { usageRecordSchema } from "@/lib/contracts";
import { finalizeUsageRecord } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, usageRecordSchema, async (body) => {
    const result = await finalizeUsageRecord(body);
    return Response.json({ ok: true, duplicate: result.duplicate });
  });
}
