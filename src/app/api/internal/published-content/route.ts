import { listVerifiedPublications } from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";

async function get(req: Request) {
  const url = new URL(req.url);
  const query = (url.searchParams.get("q") ?? "").trim();
  if (!query) return Response.json({ error: "q is required" }, { status: 400 });
  const rawLimit = Number(url.searchParams.get("limit") ?? "5");
  const limit = Number.isInteger(rawLimit) ? Math.max(1, Math.min(rawLimit, 10)) : 5;
  const publications = await listVerifiedPublications(query, limit);
  return Response.json({ query, publications, count: publications.length });
}

export const GET = internalTenantHandler(get);
