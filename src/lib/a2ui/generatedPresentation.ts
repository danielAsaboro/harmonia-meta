import { getJob, listAssets, listReceipts } from "@/lib/firestore";
import { generateResponseSurfaces } from "@/lib/a2ui/responseSurface";
import type { ChatResponse } from "@/lib/chatHandler";
import type { JobFull } from "@/components/jobTypes";
import type { HydratedSurfaceSet } from "@/lib/a2ui/hydrateSurfacePlan";

interface LoadGeneratedPresentationInput {
  runId: string;
  message: string;
  response: ChatResponse;
  loadJob?: typeof getJob;
  loadReceipts?: typeof listReceipts;
  loadAssets?: typeof listAssets;
  generate?: typeof generateResponseSurfaces;
}

export async function loadGeneratedPresentation(input: LoadGeneratedPresentationInput): Promise<{
  job: JobFull;
  surfaces: HydratedSurfaceSet;
  operations: Record<string, unknown>[];
} | null> {
  const jobId = input.response.jobId ?? input.response.job?.id ?? input.response.jobs?.[0]?.id;
  if (!jobId) return null;
  const [persistedJob, receipts, assets] = await Promise.all([
    (input.loadJob ?? getJob)(jobId),
    (input.loadReceipts ?? listReceipts)(jobId),
    (input.loadAssets ?? listAssets)(jobId),
  ]);
  const { packet: persistedPacket, verifications: persistedVerifications, ...persistedJobFields } = persistedJob;
  const job: JobFull = {
    ...persistedJobFields,
    verifications: (persistedVerifications ?? []).map((verification) => ({
      rubricItemId: verification.target,
      ...(verification.actionId ? { actionId: verification.actionId } : {}),
      verified: verification.verified,
      method: verification.method,
      evidence: verification.evidence,
      ...(verification.note ? { note: verification.note } : {}),
    })),
    ...(persistedPacket ? { packet: {
      generatedAt: persistedPacket.generatedAt,
      unresolved: persistedPacket.unresolved,
      receipts,
    } } : {}),
    assets,
  };
  const surfaces = await (input.generate ?? generateResponseSurfaces)({
    runId: input.runId,
    message: input.message,
    response: input.response,
    job,
    receipts,
  });
  return {
    job,
    surfaces,
    operations: [...surfaces.canvas, ...surfaces.conversation, ...surfaces.approval],
  };
}
