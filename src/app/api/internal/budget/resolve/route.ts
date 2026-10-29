import { budgetReservationResolutionSchema } from "@/lib/contracts";
import { resolveJobBudgetReservation } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, budgetReservationResolutionSchema, async (body) => {
    return Response.json(await resolveJobBudgetReservation(body));
  });
}
