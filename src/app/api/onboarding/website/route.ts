import { z } from "zod";
import { operatorTenantHandler } from "@/lib/auth";
import { requireContentOperator } from "@/lib/authority";
import { requestWebsiteOnboarding, saveBrandBrief } from "@/lib/brandBrief";
import { getGoals } from "@/lib/firestore";
import { currentTenant } from "@/lib/tenancy";

const schema = z.object({ url: z.string().trim().min(3).max(500) }).strict();

async function get(_req: Request) {
  return Response.json({ brandBrief: (await getGoals()).brandBrief ?? null });
}

// Give Harmonia a company website once: it reads the site, researches the market with
// Meta web search, and stores a cited brand brief that every later job starts from.
async function post(req: Request) {
  requireContentOperator(currentTenant());
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "a website URL or domain is required" }, { status: 400 });
  try {
    const brief = await saveBrandBrief(await requestWebsiteOnboarding(parsed.data.url));
    return Response.json({ brandBrief: brief }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status: 502 });
  }
}

export const GET = operatorTenantHandler(get);
export const POST = operatorTenantHandler(post);
