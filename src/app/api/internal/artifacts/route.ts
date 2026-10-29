import { z } from "zod";

import { createArtifactStore } from "@/lib/artifactStore";
import { db } from "@/lib/firestore";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { internalRoute } from "@/lib/internalHandler";

const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

const createArtifactSchema = z.object({
  jobId: z.string().min(1).max(256),
  operationId: z.string().regex(/^[A-Za-z0-9:_-]{1,512}$/),
  dataBase64: z.string().min(4).max(Math.ceil(MAX_ARTIFACT_BYTES * 4 / 3) + 4),
  contentType: z.string().min(1).max(200),
  encoding: z.string().min(1).max(50).optional(),
  itemCount: z.number().int().nonnegative().optional(),
  trust: z.enum(["system", "operator", "provider", "external_untrusted", "model_inference"]),
  sourceEventId: z.string().min(1).max(512).optional(),
  rightsAuthorizationId: z.string().regex(/^[A-Za-z0-9:_-]{1,256}$/).optional(),
  producer: z.object({
    kind: z.string().min(1).max(100),
    id: z.string().min(1).max(200),
    version: z.string().min(1).max(100),
  }).strict(),
  retentionClass: z.enum(["operational", "audit", "source", "ephemeral"]),
  expiresAt: z.string().datetime({ offset: true }).optional(),
}).strict();

function decodeBase64(value: string): Buffer {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error("artifact data is not canonical base64");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_ARTIFACT_BYTES) {
    throw new Error("artifact size is outside the allowed range");
  }
  return bytes;
}

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, createArtifactSchema, async (body) => {
    let bytes: Buffer;
    try {
      bytes = decodeBase64(body.dataBase64);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 400 });
    }
    const artifact = await createArtifactStore(db()).create({
      jobId: body.jobId,
      operationId: body.operationId,
      bytes,
      contentType: body.contentType,
      ...(body.encoding ? { encoding: body.encoding } : {}),
      ...(body.itemCount !== undefined ? { itemCount: body.itemCount } : {}),
      trust: body.trust,
      ...(body.sourceEventId ? { sourceEventId: body.sourceEventId } : {}),
      ...(body.rightsAuthorizationId ? { rightsAuthorizationId: body.rightsAuthorizationId } : {}),
      producer: body.producer,
      retentionClass: body.retentionClass,
      ...(body.expiresAt ? { expiresAt: body.expiresAt } : {}),
    });
    return Response.json({ artifact }, { status: 201 });
  }, {
    requireFence: true,
    expectedOperationId: (body) => body.operationId,
  });
}
