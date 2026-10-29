import { operatorTenantHandler } from "@/lib/auth";
import { completeAttachmentUpload } from "@/lib/chatAttachments";

async function post(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const attachment = await completeAttachmentUpload(id);
    return Response.json({ attachment: { ...attachment, previewUrl: `/api/chat/attachments/${id}` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message.includes("not found") ? 404 : 409 });
  }
}

export const POST = operatorTenantHandler(post);
