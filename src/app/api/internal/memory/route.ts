import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { memoryWriteSchema, saveMemoryFacts } from "@/lib/memoryFacts";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, memoryWriteSchema, async ({ brandId, facts }) => {
    try {
      return Response.json({ saved: await saveMemoryFacts(brandId, facts) });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 409 });
    }
  });
}
