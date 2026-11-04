import { z } from "zod";
import { operatorTenantHandler } from "@/lib/auth";
import { requireContentOperator } from "@/lib/authority";
import { listOperatorPreferences, saveOperatorPreference } from "@/lib/memoryFacts";
import { currentTenant } from "@/lib/tenancy";

const schema = z.object({ text: z.string().trim().min(3).max(400) }).strict();

async function get(_req: Request) {
  return Response.json({ preferences: await listOperatorPreferences() });
}

// "Remember this": a human operator teaches Harmonia a standing preference that
// every later job's specialists receive as memory, ahead of anything inferred.
async function post(req: Request) {
  const operator = requireContentOperator(currentTenant());
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "a preference of 3–400 characters is required" }, { status: 400 });
  return Response.json({ preference: await saveOperatorPreference(parsed.data.text, operator.subjectId) }, { status: 201 });
}

export const GET = operatorTenantHandler(get);
export const POST = operatorTenantHandler(post);
