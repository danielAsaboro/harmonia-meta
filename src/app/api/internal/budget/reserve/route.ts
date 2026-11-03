import { budgetReservationSchema } from "@/lib/contracts";
import { reserveJobBudget } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, budgetReservationSchema, async (body) => {
    const result = await reserveJobBudget(body);
    if (!result.reserved) {
      return Response.json(
        { reserved: false, error: "job budget exceeded", budget: result.budget },
        { status: 409 },
      );
    }
    return Response.json({ reserved: true, duplicate: result.duplicate, budget: result.budget });
  });
}
