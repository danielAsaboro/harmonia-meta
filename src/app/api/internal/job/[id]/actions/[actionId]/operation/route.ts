import { mediaOperationSchema } from "@/lib/contracts";
import { getMediaOperation, saveMediaOperation } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";

interface Params {
  params: Promise<{ id: string; actionId: string }>;
}

async function get(_req: Request, { params }: Params) {
  const { id, actionId } = await params;
  const operation = await getMediaOperation(id, actionId);
  if (!operation) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json({ operation });
}

async function post(req: Request, { params }: Params) {
  const { id, actionId } = await params;
  const parsed = mediaOperationSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid payload" }, { status: 400 });
  try {
    const operation = await saveMediaOperation(
      id, actionId, parsed.data.provider, parsed.data.operationName,
    );
    return Response.json({ operation });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 409 },
    );
  }
}

export const GET = internalTenantHandler(get);
export const POST = internalTenantHandler(post);
