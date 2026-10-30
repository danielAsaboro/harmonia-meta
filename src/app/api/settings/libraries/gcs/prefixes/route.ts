import { tenantHandler } from "@/lib/auth";
import { listPrefixes } from "@/lib/brandLibraries/gcs";
async function get(request: Request) { const query = new URL(request.url).searchParams; const projectId = query.get("projectId"); const bucket = query.get("bucket"); if (!projectId || !bucket) return Response.json({ error: "projectId and bucket required" }, { status: 400 }); return Response.json({ prefixes: await listPrefixes(projectId, bucket, query.get("prefix") ?? "") }); }
export const GET = tenantHandler(get);
