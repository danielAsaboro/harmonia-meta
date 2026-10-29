import { listCommandsForJob } from "@/lib/effectCommandStore";
import { isInternalAuthorized, unauthorized, withInternalTenant } from "@/lib/internalAuth";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  if (!isInternalAuthorized(req)) return unauthorized();
  return withInternalTenant(req, async () => {
    const { id } = await params;
    const commands = await listCommandsForJob(id);
    return Response.json({ commands });
  });
}
