import { z } from "zod";

import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";
import { runRecovery } from "@/lib/recoveryStore";

const schema = z.object({
  limit: z.number().int().min(1).max(100),
  deadlineSeconds: z.number().int().min(1).max(60),
  maxRetries: z.number().int().min(0).max(20),
  maxCostUsd: z.string().regex(/^\d+(?:\.\d{1,6})?$/),
}).strict();

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, schema, async (body) => Response.json(await runRecovery(body)));
}
