import { internalTenantHandler } from "@/lib/internalAuth";
import { getAttachmentBytesForInternal } from "@/lib/chatAttachments";

async function get(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const { bytes, attachment } = await getAttachmentBytesForInternal(id);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": attachment.mime,
        "content-length": String(bytes.length),
        "x-attachment-filename": encodeURIComponent(attachment.filename),
        "cache-control": "private, no-store",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}

export const GET = internalTenantHandler(get);
