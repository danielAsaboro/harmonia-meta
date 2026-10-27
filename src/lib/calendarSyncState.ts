import type { ContentItem, GoogleCalendarSync } from "./types";

const MATERIAL_FIELDS = new Set(["text", "scheduledFor", "platforms", "status"]);

export function markCalendarSyncStale(item: ContentItem, patch: Partial<ContentItem>): ContentItem {
  if (!item.googleCalendarSync || item.googleCalendarSync.status !== "synced") return { ...item, ...patch };
  const changed = Object.entries(patch).some(([key, value]) =>
    MATERIAL_FIELDS.has(key) && JSON.stringify(value) !== JSON.stringify(item[key as keyof ContentItem]),
  );
  return {
    ...item,
    ...patch,
    googleCalendarSync: changed
      ? { ...item.googleCalendarSync, status: "update_required" }
      : item.googleCalendarSync,
  };
}

export function calendarSyncFailure(item: ContentItem, now: string, error: unknown): GoogleCalendarSync {
  void error;
  return {
    ...item.googleCalendarSync,
    status: "failed",
    calendarId: item.googleCalendarSync?.calendarId ?? "",
    eventId: item.googleCalendarSync?.eventId ?? "",
    verifiedAt: item.googleCalendarSync?.verifiedAt,
    lastAttemptAt: now,
    failureReason: "Google Calendar synchronization failed",
  };
}

export function calendarSyncActionLabel(status?: GoogleCalendarSync["status"]): string {
  if (status === "failed") return "Retry Google Calendar sync";
  if (status === "synced" || status === "update_required") return "Update Google Calendar";
  return "Add to Google Calendar";
}
