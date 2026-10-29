import { z } from "zod";

import { createContextProjectionStore } from "@/lib/contextProjectionStore";
import { createContextProjection } from "@/lib/contextProjections";
import { db } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute, readOperationFenceHeaders } from "@/lib/internalHandler";
import { currentTenant } from "@/lib/tenancy";

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const artifactId = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const manifestSchema = z.object({
  compilerVersion: z.string().min(1).max(100),
  operationId: z.string().regex(/^[A-Za-z0-9:_-]{1,512}$/),
  operationEpoch: z.number().int().positive(),
  model: z.string().min(1).max(256),
  goalDigest: digest,
  policyVersion: z.string().min(1).max(256),
  pinnedConstraints: z.array(z.object({ id: z.string().min(1).max(256), digest }).strict()).max(100),
  approvalIds: z.array(z.string().min(1).max(512)).max(100),
  unresolvedEffectIds: z.array(z.string().min(1).max(512)).max(100),
  currentRevisions: z.array(z.object({
    kind: z.string().min(1).max(100), id: z.string().min(1).max(256),
    revision: z.number().int().positive(), digest,
  }).strict()).max(100),
  evidence: z.array(z.object({
    id: z.string().min(1).max(256),
    trust: z.enum(["system", "operator", "provider", "external_untrusted", "model_inference"]),
    digest,
    artifactId: artifactId.optional(),
  }).strict()).max(100),
  memory: z.array(z.object({
    id: z.string().min(1).max(256), digest, evidenceRef: z.string().min(1).max(512),
  }).strict()).max(20),
  recentEventIds: z.array(z.string().min(1).max(512)).max(100),
  artifactRefs: z.array(artifactId).max(200),
  maxChars: z.number().int().min(500).max(200_000),
}).strict();

const submissionSchema = z.object({
  jobId: z.string().min(1).max(256),
  manifest: manifestSchema,
  renderedDigest: digest,
  renderedChars: z.number().int().positive().max(200_000),
  renderedArtifactId: artifactId,
}).strict();

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, submissionSchema, async (body) => {
    const fence = readOperationFenceHeaders(req);
    if (body.manifest.operationEpoch !== fence.epoch) {
      return Response.json({ error: "projection manifest epoch differs from live fence" }, { status: 409 });
    }
    const tenant = currentTenant();
    const projection = createContextProjection({
      workspaceId: tenant.workspaceId,
      brandId: tenant.brandId,
      jobId: body.jobId,
      manifest: body.manifest,
      renderedDigest: body.renderedDigest,
      renderedChars: body.renderedChars,
      renderedArtifactId: body.renderedArtifactId,
      now: new Date().toISOString(),
    });
    const result = await createContextProjectionStore(db()).create(projection, {
      operationId: fence.operationId,
      workspaceId: tenant.workspaceId,
      brandId: tenant.brandId,
      epoch: fence.epoch,
      now: new Date().toISOString(),
    });
    return Response.json(result, { status: result.created ? 201 : 200 });
  }, {
    requireFence: true,
    expectedOperationId: (body) => body.manifest.operationId,
  });
}
