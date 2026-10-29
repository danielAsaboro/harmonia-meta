import { z } from "zod";
import { createNotification, getContentItem, updateContentItem } from "@/lib/firestore";
import { operatorTenantHandler } from "@/lib/auth";
import { approveScheduledContent } from "@/lib/scheduledEffects";
import { currentTenant } from "@/lib/tenancy";

/** Final human approval for approval-mode scheduled items. */
async function post(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const parsed = z.object({ decision: z.enum(["approved", "rejected"]) }).strict().safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "expected decision approved|rejected" }, { status: 400 });
  }
  const item = await getContentItem(id);
  if (!item) return Response.json({ error: "item not found" }, { status: 404 });
  if (item.status !== "awaiting_final_review") {
    return Response.json({ error: `item status is '${item.status}'` }, { status: 409 });
  }

  if (parsed.data.decision === "rejected") {
    await updateContentItem(id, { status: "cancelled", scheduledFor: undefined as unknown as string });
    await createNotification({
      kind: "item_cancelled",
      title: "Scheduled post cancelled",
      body: `"${item.text.slice(0, 80)}" was rejected at final review.`,
      severity: "info",
      refType: "content_item",
      refId: id,
      href: "/dashboard/calendar",
      createdAt: new Date().toISOString(),
    });
    return Response.json({ ok: true, status: "cancelled" });
  }

  const result = await approveScheduledContent(id, currentTenant());
  return Response.json({ ok: true, status: "publishing", commandId: result.command.id });
}

export const POST = operatorTenantHandler(post);
