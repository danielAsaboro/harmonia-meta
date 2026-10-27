import { z } from "zod";
import { TransitionError } from "./stages";
import { withInternalTenant } from "./internalAuth";
import { withTraceContext } from "./telemetry";
import { assertDurableOperationFence } from "./firestore";
import { currentTenant } from "./tenancy";

class OperationFenceHeaderError extends Error {}
class OperationFenceConflict extends Error {}

export const INTERNAL_CONTRACT_REVISION = "internal-contract-2026-09-04.1";

export function isOperationFenceConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return [
    "operation not found",
    "operation id mismatch",
    "operation tenant mismatch",
    "operation epoch mismatch",
    "operation lease expired",
    "claimed operation has no lease expiry",
  ].includes(error.message) || error.message.startsWith("operation is ");
}

export interface InternalRouteOptions<Body = unknown> {
  requireFence?: boolean;
  expectedOperationId?: (body: Body) => string;
}

export function readOperationFenceHeaders(req: Request): { operationId: string; epoch: number } {
  const operationId = req.headers.get("x-harmonia-operation-id") ?? "";
  const rawEpoch = req.headers.get("x-harmonia-operation-epoch") ?? "";
  if (!operationId || !rawEpoch) throw new OperationFenceHeaderError("operation fence headers required");
  if (!/^[A-Za-z0-9:_-]{1,512}$/.test(operationId)) {
    throw new OperationFenceHeaderError("operation id header is invalid");
  }
  if (!/^\d+$/.test(rawEpoch)) throw new OperationFenceHeaderError("operation epoch header is invalid");
  const epoch = Number(rawEpoch);
  if (!Number.isSafeInteger(epoch) || epoch < 1) {
    throw new OperationFenceHeaderError("operation epoch header is invalid");
  }
  return { operationId, epoch };
}

export async function internalRoute<S extends z.ZodType>(
  req: Request,
  schema: S,
  handler: (body: z.infer<S>) => Promise<Response | void>,
  options: InternalRouteOptions<z.infer<S>> = {},
): Promise<Response> {
  const bodyJson = await req.json().catch(() => null);
  const parsed = schema.safeParse(bodyJson);
  if (!parsed.success) {
    const issues = parsed.error.issues.slice(0, 12).map((issue) => {
      const bounded = issue as typeof issue & { maximum?: number | bigint; minimum?: number | bigint };
      return {
        path: issue.path.map(String).join(".") || "<root>",
        code: issue.code,
        ...(typeof bounded.maximum === "number" ? { maximum: bounded.maximum } : {}),
        ...(typeof bounded.minimum === "number" ? { minimum: bounded.minimum } : {}),
      };
    });
    return Response.json(
      { error: "invalid payload", contractRevision: INTERNAL_CONTRACT_REVISION, issues },
      { status: 400 },
    );
  }
  try {
    const result = await withTraceContext(req.headers, () => withInternalTenant(req, async () => {
      if (options.requireFence) {
        const headerFence = readOperationFenceHeaders(req);
        if (
          options.expectedOperationId
          && options.expectedOperationId(parsed.data) !== headerFence.operationId
        ) {
          throw new OperationFenceConflict("operation fence does not authorize this mutation");
        }
        const tenant = currentTenant();
        try {
          await assertDurableOperationFence({
            ...headerFence,
            workspaceId: tenant.workspaceId,
            brandId: tenant.brandId,
            now: new Date().toISOString(),
          });
        } catch (error) {
          if (isOperationFenceConflict(error)) {
            throw new OperationFenceConflict((error as Error).message);
          }
          throw error;
        }
      }
      return handler(parsed.data);
    }));
    return result ?? Response.json({ ok: true });
  } catch (err) {
    if (err instanceof OperationFenceHeaderError) {
      return Response.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof OperationFenceConflict) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof TransitionError) {
      return Response.json({ error: err.message }, { status: 409 });
    }
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: message }, { status: 500 });
  }
}
