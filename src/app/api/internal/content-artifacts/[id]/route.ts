import { contentArtifactSchema } from "@/lib/contentArtifacts/contracts";
import { db, getJob } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";
import { currentTenant } from "@/lib/tenancy";

async function get(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const jobId = url.searchParams.get("jobId") ?? "";
  const digest = url.searchParams.get("digest") ?? "";
  if (!jobId || !/^[0-9a-f]{64}$/.test(digest)) {
    return Response.json({ error: "jobId and canonical artifact digest are required" }, { status: 400 });
  }
  const job = await getJob(jobId);
  const summary = job.contentArtifacts?.find(
    (artifact) => artifact.id === id && artifact.contentDigest === digest,
  );
  if (!summary) return Response.json({ error: "content artifact not found" }, { status: 404 });
  const tenant = currentTenant();
  const revision = await db().doc(
    `workspaces/${tenant.workspaceId}/jobs/${jobId}/content_artifacts/${id}/revisions/${summary.revision}`,
  ).get();
  if (!revision.exists) return Response.json({ error: "content artifact revision is missing" }, { status: 409 });
  const artifact = contentArtifactSchema.parse(revision.data());
  if (artifact.contentDigest !== digest || artifact.jobId !== jobId) {
    return Response.json({ error: "content artifact revision identity mismatch" }, { status: 409 });
  }
  return Response.json({ artifact });
}

export const GET = internalTenantHandler(get);
