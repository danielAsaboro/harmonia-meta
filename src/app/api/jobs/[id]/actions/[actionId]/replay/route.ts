import { administratorTenantHandler } from "@/lib/auth";
import { requestReplayProof } from "@/lib/replay";

async function post(
  _req: Request,
  { params }: { params: Promise<{ id: string; actionId: string }> },
) {
  const { id, actionId } = await params;
  try {
    const proof = await requestReplayProof(id, actionId);
    return Response.json({ ok: true, outcome: "already_applied", ...proof });
  } catch (error) {
    const message = error instanceof Error ? error.message : "replay proof failed";
    return Response.json({ error: message }, { status: 409 });
  }
}

export const POST = administratorTenantHandler(post);
