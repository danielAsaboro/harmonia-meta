import { failureSubmissionSchema } from "@/lib/contracts";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";
import { recordFailure } from "@/lib/advance";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, failureSubmissionSchema, async (body) => {
    await recordFailure(body);
    // Persistence only: the worker's typed envelope owns the bounded retry decision.
    return Response.json({ ok: true });
  });
}
