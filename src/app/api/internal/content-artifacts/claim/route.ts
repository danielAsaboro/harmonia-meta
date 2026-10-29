import { z } from "zod";
import { claimSelectedEditorialItem } from "@/lib/firestore";
import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";

const schema = z.object({
  jobId: z.string().min(1),
  editorialPlanId: z.string().min(1),
  editorialPlanDigest: z.string().regex(/^[a-f0-9]{64}$/),
  editorialItemId: z.string().min(1),
  briefId: z.string().min(1),
}).strict();

export async function POST(request: Request) {
  if (!isInternalAuthorized(request)) return unauthorized();
  return internalRoute(request, schema, async (body) => Response.json(await claimSelectedEditorialItem(body.jobId, body)));
}
