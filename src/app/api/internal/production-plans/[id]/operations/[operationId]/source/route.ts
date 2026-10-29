import { internalTenantHandler } from "@/lib/internalAuth";
import { productionPlanError } from "@/lib/productionPlanHttp";
import { getProductionSourceArtifact } from "@/lib/productionPlanStore";

async function get(
  request: Request,
  { params }: { params: Promise<{ id: string; operationId: string }> },
) {
  const { id, operationId } = await params;
  const claimId = request.headers.get("x-claim-id") ?? "";
  const claimToken = request.headers.get("x-claim-token") ?? "";
  if (!/^[A-Za-z0-9:_-]{1,256}$/.test(claimId) || !claimToken || claimToken.length > 512) {
    return Response.json({ error: "invalid production source claim" }, { status: 400 });
  }
  try {
    const { record, bytes } = await getProductionSourceArtifact(id, operationId, { claimId, claimToken });
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": record.contentType,
        "content-length": String(record.byteCount),
        "x-artifact-id": record.id,
        "x-artifact-digest": record.sha256,
        "x-rights-authorization-id": record.rightsAuthorizationId!,
      },
    });
  } catch (error) {
    return productionPlanError(error);
  }
}

export const GET = internalTenantHandler(get);
