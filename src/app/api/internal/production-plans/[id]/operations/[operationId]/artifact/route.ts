import { createHash } from "node:crypto";
import { z } from "zod";

import { internalTenantHandler } from "@/lib/internalAuth";
import { productionPlanError } from "@/lib/productionPlanHttp";
import { completeProductionOperation, getProductionOperationArtifact } from "@/lib/productionPlanStore";
import { getDurableArtifactObject, putDurableArtifactObject } from "@/lib/storage";
import { currentTenant } from "@/lib/tenancy";

const MAX_BYTES = 64 * 1024 * 1024;
const mimeSchema = z.enum([
  "video/mp4", "audio/mpeg", "audio/wav", "image/jpeg", "image/png",
  "application/zip", "application/json",
]);
const metadataSchema = z.record(z.string(), z.unknown());

async function post(
  request: Request,
  { params }: { params: Promise<{ id: string; operationId: string }> },
) {
  const { id, operationId } = await params;
  const claimId = request.headers.get("x-claim-id") ?? "";
  const claimToken = request.headers.get("x-claim-token") ?? "";
  const expectedDigest = request.headers.get("x-artifact-digest") ?? "";
  const parsedMime = mimeSchema.safeParse(request.headers.get("x-artifact-mime"));
  const metadataText = request.headers.get("x-operation-metadata") ?? "";
  let metadataJson: unknown = null;
  try {
    if (metadataText.length <= 8192) metadataJson = JSON.parse(metadataText || "null");
  } catch {
    metadataJson = null;
  }
  const parsedMetadata = metadataSchema.safeParse(metadataJson);
  if (
    !/^[A-Za-z0-9:_-]{1,256}$/.test(claimId)
    || !claimToken
    || claimToken.length > 512
    || !/^[a-f0-9]{64}$/.test(expectedDigest)
    || !parsedMime.success
    || !parsedMetadata.success
  ) return Response.json({ error: "invalid production artifact metadata" }, { status: 400 });

  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: "production artifact size outside allowed range" }, { status: 413 });
  }
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== expectedDigest) {
    return Response.json({ error: "production artifact digest mismatch" }, { status: 409 });
  }
  try {
    const tenant = currentTenant();
    const extension = parsedMime.data === "video/mp4" ? "mp4"
      : parsedMime.data === "audio/mpeg" ? "mp3"
        : parsedMime.data === "audio/wav" ? "wav"
          : parsedMime.data === "image/jpeg" ? "jpg"
            : parsedMime.data === "image/png" ? "png"
              : parsedMime.data === "application/zip" ? "zip" : "json";
    const objectKey = `durable-artifacts/${tenant.workspaceId}/${tenant.brandId}/production/${id}/${claimId}/${digest}.${extension}`;
    await putDurableArtifactObject(objectKey, bytes, parsedMime.data);
    const claim = await completeProductionOperation(id, operationId, {
      claimId,
      claimToken,
      artifact: { objectKey, mime: parsedMime.data, digest, sizeBytes: bytes.byteLength },
      operationMetadata: parsedMetadata.data,
    });
    return Response.json({ claim });
  } catch (error) {
    return productionPlanError(error);
  }
}

async function get(
  _request: Request,
  { params }: { params: Promise<{ id: string; operationId: string }> },
) {
  const { id, operationId } = await params;
  try {
    const artifact = await getProductionOperationArtifact(id, operationId);
    const bytes = await getDurableArtifactObject(artifact.objectKey);
    if (!bytes || createHash("sha256").update(bytes).digest("hex") !== artifact.digest) {
      return Response.json({ error: "production artifact bytes failed verification" }, { status: 409 });
    }
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": artifact.mime,
        "content-length": String(bytes.byteLength),
        "x-artifact-digest": artifact.digest,
      },
    });
  } catch (error) {
    return productionPlanError(error);
  }
}

export const POST = internalTenantHandler(post);
export const GET = internalTenantHandler(get);
