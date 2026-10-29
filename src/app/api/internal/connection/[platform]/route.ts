import { internalTenantHandler } from "@/lib/internalAuth";
import { validPlatformConnection } from "@/lib/validConnection";

async function get(
  _req: Request,
  { params }: { params: Promise<{ platform: string }> },
) {
  const { platform } = await params;
  const connection = await validPlatformConnection(platform);
  return Response.json({ connection });
}

export const GET = internalTenantHandler(get);
