import {
  createNotification,
  listContentItems,
  updateContentItem,
} from "@/lib/firestore";
import { internalTenantHandler } from "@/lib/internalAuth";
import { listDueCommands } from "@/lib/effectCommandStore";

/**
 * Scheduler wake-up feed. It returns command IDs only; immutable payloads are
 * fetched through the command endpoint after claim acquisition.
 */
async function get(_req: Request) {
  const now = Date.now();
  const items = await listContentItems();
  for (const item of items) {
    if (item.status !== "scheduled" || !item.scheduledFor) continue;
    if (Date.parse(item.scheduledFor) > now) continue;
    if (item.publishMode === "approval" || !item.effectCommandId) {
      await updateContentItem(item.id, { status: "awaiting_final_review" });
      await createNotification({
        kind: "final_review_needed",
        title: "Final review needed",
        body: `"${item.text.slice(0, 80)}" is due for ${item.platforms.join(", ")}. Approve to publish.`,
        severity: "warning",
        refType: "content_item",
        refId: item.id,
        href: "/dashboard/calendar",
        createdAt: new Date().toISOString(),
      });
      continue;
    }
  }
  for (const item of items.filter((candidate) => candidate.status === "publishing" && !candidate.effectCommandId)) {
    await updateContentItem(item.id, { status: "awaiting_final_review" });
  }
  const commands = await listDueCommands(new Date(now));
  return Response.json({ commandIds: commands.map((command) => command.id) });
}

export const GET = internalTenantHandler(get);
