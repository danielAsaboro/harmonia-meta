import { tenantHandler } from "@/lib/auth";
import { listAuthorizedBuckets } from "@/lib/brandLibraries/gcs";
async function get(request: Request) { const projectId = new URL(request.url).searchParams.get("projectId"); if (!projectId) return Response.json({ error: "projectId required" }, { status: 400 }); return Response.json({ buckets: await listAuthorizedBuckets(projectId) }); }
export const GET = tenantHandler(get);
