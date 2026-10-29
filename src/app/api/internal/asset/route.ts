import { z } from "zod";
import { getJob, saveAsset } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";
import { putArtifact } from "@/lib/storage";

const MAX_BYTES = 64 * 1024 * 1024; // clips stay well under this at 720p CRF23

const assetMetaSchema = z.object({
  jobId: z.string().min(1),
  actionId: z.string().min(1),
  mime: z.enum(["image/png", "image/jpeg", "image/webp", "video/mp4"]),
  digest: z.string().min(16),
});

/**
 * Worker stores a generated/rendered asset after execution. Bytes go to the
 * storage backend (GCS in cloud, disk locally); Firestore keeps metadata.
 * Accepts JSON {dataBase64} (images) or raw octet-stream bodies (clips).
 */
async function post(req: Request) {

  let metaRaw: Record<string, unknown>;
  let bytes: Uint8Array;
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    const body = await req.json().catch(() => null);
    const parsed = z
      .object({ dataBase64: z.string().min(4) })
      .and(assetMetaSchema)
      .safeParse(body);
    if (!parsed.success) {
      return Response.json({ error: "invalid asset submission", detail: parsed.error.flatten() }, { status: 400 });
    }
    metaRaw = parsed.data;
    bytes = new Uint8Array(Buffer.from(parsed.data.dataBase64, "base64"));
  } else {
    metaRaw = {
      jobId: req.headers.get("x-job-id") ?? "",
      actionId: req.headers.get("x-action-id") ?? "",
      mime: req.headers.get("x-mime") ?? "",
      digest: req.headers.get("x-digest") ?? "",
    };
    bytes = new Uint8Array(await req.arrayBuffer());
  }

  const parsed = assetMetaSchema.safeParse(metaRaw);
  if (!parsed.success) {
    return Response.json({ error: "invalid asset metadata", detail: parsed.error.flatten() }, { status: 400 });
  }
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return Response.json({ error: `asset size ${bytes.byteLength} outside allowed range` }, { status: 413 });
  }

  const job = await getJob(parsed.data.jobId);
  const action = job.actions.find((a) => a.id === parsed.data.actionId);
  if (
    !action ||
    !(
      action.type === "generate_image" ||
      action.type === "render_clip" ||
      action.type === "render_reel"
    )
  ) {
    return Response.json({ error: "action is not an asset-producing action for this job" }, { status: 409 });
  }
  if (job.stage !== "publish") {
    return Response.json(
      { error: `job stage is '${job.stage}', assets accepted at 'publish'` },
      { status: 409 },
    );
  }

  const key = `${parsed.data.jobId}_${parsed.data.actionId}`;
  const uri = await putArtifact(key, bytes, parsed.data.mime);
  await saveAsset({
    jobId: parsed.data.jobId,
    actionId: parsed.data.actionId,
    mime: parsed.data.mime,
    digest: parsed.data.digest,
    sizeBytes: bytes.byteLength,
    storageUri: uri,
    createdAt: new Date().toISOString(),
  });
  return Response.json({ ok: true, uri, sizeBytes: bytes.byteLength });
}

export const POST = internalTenantHandler(post);
