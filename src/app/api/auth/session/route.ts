import { clearSessionCookie, createDevSessionCookie, createSessionCookie, isDevAuthBypassEnabled } from "@/lib/auth";
import { z } from "zod";

const schema = z.union([
  z.object({ idToken: z.string().min(100) }).strict(),
  z.object({ devBypass: z.literal(true) }).strict(),
]);

export async function GET() {
  return Response.json({ devBypassEnabled: isDevAuthBypassEnabled() });
}

export async function POST(req: Request) {
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid identity token" }, { status: 400 });
  try {
    const cookie = "devBypass" in parsed.data
      ? createDevSessionCookie()
      : await createSessionCookie(parsed.data.idToken);
    return Response.json({ ok: true }, { headers: { "set-cookie": cookie } });
  } catch (error) {
    const status = "devBypass" in parsed.data ? 403 : 401;
    console.error("session creation failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      message: error instanceof Error ? error.message : "authentication failed",
      code: typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : undefined,
    });
    return Response.json({ error: error instanceof Error ? error.message : "authentication failed" }, { status });
  }
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
}
