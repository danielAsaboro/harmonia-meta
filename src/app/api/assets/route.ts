import { listAllAssets } from "@/lib/firestore";
import { tenantHandler } from "@/lib/auth";

/** Asset gallery: every generated image / rendered clip across all jobs. */
async function get(_req: Request) {
  const assets = await listAllAssets();
  return Response.json({
    assets: assets.map((a) => ({
      actionId: a.actionId,
      jobId: a.jobId,
      mime: a.mime,
      digest: a.digest,
      sizeBytes: a.sizeBytes,
      createdAt: a.createdAt,
    })),
  });
}

export const GET = tenantHandler(get);
