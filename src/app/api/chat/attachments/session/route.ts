import { z } from "zod";
import { operatorTenantHandler } from "@/lib/auth";
import { attachmentOriginPolicy } from "@/lib/attachmentOrigins";
import { createAttachmentUploadSession } from "@/lib/chatAttachments";

const requestSchema = z.object({
  filename: z.string().min(1).max(255),
  mime: z.string().min(1).max(120),
  sizeBytes: z.number().int().positive(),
}).strict();

async function post(req: Request) {
  const parsed = requestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid attachment metadata" }, { status: 400 });
  const originPolicy = attachmentOriginPolicy(process.env, req.url);
  const requestOrigin = req.headers.get("origin");
  if (!originPolicy.accepts(requestOrigin)) {
    return Response.json({ error: "attachment origin denied" }, { status: 403 });
  }
  try {
    const session = await createAttachmentUploadSession(parsed.data, originPolicy.uploadOrigin(requestOrigin));
    return Response.json({
      attachment: {
        id: session.attachment.id,
        filename: session.attachment.filename,
        mime: session.attachment.mime,
        sizeBytes: session.attachment.sizeBytes,
        state: session.attachment.state,
      },
      uploadUrl: session.uploadUrl,
      method: session.method,
      headers: session.headers,
    }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes("unsupported") || message.includes("exceeds") || message.includes("invalid") ? 400 : 502;
    return Response.json({ error: message }, { status });
  }
}

export const POST = operatorTenantHandler(post);
