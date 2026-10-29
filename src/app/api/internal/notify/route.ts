import { z } from "zod";
import { createNotification } from "@/lib/firestore";
import { internalRoute } from "@/lib/internalHandler";
import { isInternalAuthorized, unauthorized } from "@/lib/internalAuth";

const notifySchema = z.object({
  kind: z.string().min(1).max(40),
  title: z.string().min(1).max(120),
  body: z.string().min(1).max(500),
  severity: z.enum(["info", "warning", "critical"]).default("info"),
  href: z.string().max(200).optional(),
});

/** Lets proactive checks raise bell notifications without faking a job. */
export async function POST(req: Request) {
  if (!isInternalAuthorized(req)) return unauthorized();
  return internalRoute(req, notifySchema, async (body) => {
    await createNotification({
      kind: body.kind,
      title: body.title,
      body: body.body,
      severity: body.severity,
      href: body.href,
      createdAt: new Date().toISOString(),
      readAt: null,
    });
    return Response.json({ ok: true });
  });
}
