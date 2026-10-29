import { operatorTenantHandler } from "@/lib/auth";
import { getAttachmentDelivery, storeLocalAttachment } from "@/lib/chatAttachments";

async function get(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const delivery = await getAttachmentDelivery(id);
    if (delivery.redirect) return Response.redirect(delivery.redirect, 302);
    return new Response(new Uint8Array(delivery.bytes!), {
      headers: {
        "content-type": delivery.mime,
        "content-length": String(delivery.bytes!.length),
        "cache-control": "private, max-age=300",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 404 });
  }
}

async function put(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (process.env.GCS_BUCKET) return Response.json({ error: "direct Cloud Storage upload required" }, { status: 409 });
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    const attachment = await storeLocalAttachment(id, bytes, req.headers.get("content-type") ?? "");
    return Response.json({ attachment: { ...attachment, previewUrl: `/api/chat/attachments/${id}` } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return Response.json({ error: message }, { status: message.includes("not found") ? 404 : 409 });
  }
}

export const GET = operatorTenantHandler(get);
export const PUT = operatorTenantHandler(put);
