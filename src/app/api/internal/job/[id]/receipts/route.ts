import { listReceipts } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";

async function get(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const receipts = await listReceipts(id);
  return Response.json({ receipts });
}

export const GET = internalTenantHandler(get);
