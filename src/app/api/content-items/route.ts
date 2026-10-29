import { z } from "zod";
import {
  getConnection,
  getContentItem,
  listContentItems,
} from "@/lib/firestore";
import { operatorTenantHandler } from "@/lib/auth";
import { validateDraftText } from "@/lib/policy";
import { markCalendarSyncStale } from "@/lib/calendarSyncState";
import { applyScheduledContentMutation } from "@/lib/scheduledEffects";
import { currentTenant } from "@/lib/tenancy";

/** All items for the calendar / trays. */
async function get(_req: Request) {
  return Response.json({ items: await listContentItems() });
}

const patchSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1).max(2000).optional(),
  scheduledFor: z.string().datetime().nullable().optional(),
  publishMode: z.enum(["auto", "approval"]).optional(),
  status: z.enum(["draft", "scheduled", "cancelled"]).optional(),
});

function badRequest(error: string, detail?: unknown) {
  return Response.json({ error, detail }, { status: 400 });
}

/**
 * Edits, schedules, reschedules, or cancels a content item. Published items
 * are immutable. Auto mode requires every target channel to be connected.
 */
async function patch(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return badRequest("invalid patch", parsed.error.flatten());
  const { id, ...patch } = parsed.data;
  const item = await getContentItem(id);
  if (!item) return Response.json({ error: "item not found" }, { status: 404 });
  if (["published", "publishing"].includes(item.status)) {
    return Response.json({ error: "published items are immutable" }, { status: 409 });
  }
  const updates: Record<string, unknown> = {};

  if (patch.text !== undefined && patch.text !== item.text) {
    const check = validateDraftText(item.platforms[0] ?? "x", patch.text);
    if (!check.valid) return badRequest(check.note);
    updates.text = patch.text;
    // keep an audit trail of pre-publication edits
    updates.revisions = [...(item.revisions ?? []), { text: item.text, at: new Date().toISOString() }];
  }

  if (patch.publishMode === "auto") {
    // Guardrail: auto-publishing requires live connections on all targets.
    const unconnected: string[] = [];
    for (const p of item.platforms) {
      const conn = await getConnection(p);
      const expired = conn?.expiresAt ? Date.parse(conn.expiresAt) < Date.now() : false;
      if (!conn || expired || conn.mode === "manual") unconnected.push(p);
    }
    if (unconnected.length > 0) {
      return Response.json(
        {
          error: `auto mode needs connected channels; not connected: ${unconnected.join(", ")}`,
          degradedTo: "approval",
        },
        { status: 409 },
      );
    }
    updates.publishMode = "auto";
  } else if (patch.publishMode) {
    updates.publishMode = patch.publishMode;
  }

  if (patch.scheduledFor !== undefined) {
    if (patch.scheduledFor === null) {
      updates.scheduledFor = null;
      updates.status = "draft";
    } else {
      updates.scheduledFor = patch.scheduledFor;
      updates.status = "scheduled";
    }
  }

  if (patch.status === "cancelled") {
    updates.status = "cancelled";
    updates.scheduledFor = null;
  } else if (patch.status === "draft" && !("scheduledFor" in updates)) {
    updates.status = "draft";
  } else if (patch.status === "scheduled") {
    updates.status = "scheduled";
    if (!updates.scheduledFor && !item.scheduledFor) {
      return badRequest("cannot schedule without a time");
    }
  }

  // Strip undefined values — Firestore rejects them even in merge writes.
  const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
  const next = markCalendarSyncStale(item, clean as Partial<typeof item>);
  if (next.googleCalendarSync !== item.googleCalendarSync) clean.googleCalendarSync = next.googleCalendarSync;
  const result = await applyScheduledContentMutation(id, clean as Partial<typeof item> & { scheduledFor?: string | null }, currentTenant());
  return Response.json({ ok: true, item: result.item });
}

export const GET = operatorTenantHandler(get);
export const PATCH = operatorTenantHandler(patch);
