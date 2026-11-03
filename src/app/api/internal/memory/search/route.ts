import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";
import { memorySearchSchema, searchMemoryFacts } from "@/lib/memoryFacts";

export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, memorySearchSchema, async ({ brandId, query, topK }) => (
    Response.json({ facts: await searchMemoryFacts(brandId, query, topK) })
  ));
}
