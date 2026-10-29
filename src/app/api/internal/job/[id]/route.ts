import { getJob } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";

async function get(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const job = await getJob(id);
  return Response.json({ job });
}

export const GET = internalTenantHandler(get);
