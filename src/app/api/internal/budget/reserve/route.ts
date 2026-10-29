import { budgetReservationSchema } from "@/lib/contracts";
import { reserveJobBudget } from "@/lib/firestore";
import { authorizeProductionBudgetReservation } from "@/lib/productionPlanStore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, budgetReservationSchema, async (body) => {
    const { productionAuthorization, ...reservation } = body;
    if (productionAuthorization) {
      await authorizeProductionBudgetReservation({
        ...productionAuthorization,
        jobId: reservation.jobId,
        estimatedCostUsd: reservation.estimatedCostUsd,
        pricingVersion: reservation.pricingVersion,
      });
    }
    const result = await reserveJobBudget(reservation, { approvalAuthorized: Boolean(productionAuthorization) });
    if (!result.reserved) {
      return Response.json(
        { reserved: false, error: "job budget exceeded", budget: result.budget },
        { status: 409 },
      );
    }
    return Response.json({ reserved: true, duplicate: result.duplicate, budget: result.budget });
  });
}
