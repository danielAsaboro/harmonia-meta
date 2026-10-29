import { getAsset } from "@/lib/firestore";
import { createHash } from "node:crypto";
import { getArtifact } from "@/lib/storage";
import { internalTenantHandler } from "@/lib/internalAuth";

/** Independent byte readback; saved digest metadata is not verification evidence. */
async function get(
  req: Request,
  { params }: { params: Promise<{ id: string; actionId: string }> },
) {
  const { id, actionId } = await params;
  const asset = await getAsset(id, actionId);
  if (!asset) {
    return Response.json({ error: "asset not found" }, { status: 404 });
  }
  const bytes = await getArtifact(`${id}_${actionId}`);
  if (!bytes) {
    return Response.json({ error: "artifact bytes missing from store" }, { status: 410 });
  }
  return Response.json({
    jobId: asset.jobId,
    actionId: asset.actionId,
    mime: asset.mime,
    digest: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: bytes.length,
    storageUri: asset.storageUri,
    createdAt: asset.createdAt,
  });
}

export const GET = internalTenantHandler(get);
