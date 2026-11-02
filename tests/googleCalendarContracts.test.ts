import { describe, expect, it } from "vitest";
import { buildGoogleCalendarEvent, googleCalendarEventId } from "@/lib/googleCalendarContracts";
import { calendarSyncActionLabel, markCalendarSyncStale } from "@/lib/calendarSyncState";
import type { ContentItem } from "@/lib/types";

const item: ContentItem = {
  id: "item-42", jobId: "job-9", text: "Ship the launch post", platforms: ["x", "linkedin"],
  status: "scheduled", publishMode: "approval", scheduledFor: "2026-08-26T10:00:00.000Z",
  createdAt: "2026-08-25T09:00:00.000Z", updatedAt: "2026-08-25T09:30:00.000Z",
};

describe("Google Calendar contracts", () => {
  it("produces a stable base32hex-compatible event id", () => {
    const first = googleCalendarEventId("workspace-a:brand-a", "item-42");
    expect(first).toMatch(/^[0-9a-v]{32}$/);
    expect(googleCalendarEventId("workspace-a:brand-a", "item-42")).toBe(first);
    expect(googleCalendarEventId("workspace-a:brand-a", "item-43")).not.toBe(first);
  });

  it("projects a scheduled content item into a transparent 30-minute event", () => {
    expect(buildGoogleCalendarEvent(item, "event123", "workspace-a", "brand-a")).toEqual({
      id: "event123",
      summary: "Harmonia · X + LinkedIn",
      description: "Ship the launch post\n\nHarmonia content item: item-42\nJob: job-9",
      start: { dateTime: "2026-08-26T10:00:00.000Z" },
      end: { dateTime: "2026-08-26T10:30:00.000Z" },
      transparency: "transparent",
      extendedProperties: { private: { harmoniaWorkspaceId: "workspace-a", harmoniaBrandId: "brand-a", harmoniaContentItemId: "item-42", harmoniaJobId: "job-9" } },
    });
  });

  it("marks a verified sync stale only when event material changes", () => {
    const synced: ContentItem = { ...item, googleCalendarSync: { status: "synced", calendarId: "cal", eventId: "evt", etag: "v1", sourceUpdatedAt: item.updatedAt, verifiedAt: item.updatedAt } };
    expect(markCalendarSyncStale(synced, { publishMode: "auto" }).googleCalendarSync?.status).toBe("synced");
    expect(markCalendarSyncStale(synced, { text: "Changed" }).googleCalendarSync?.status).toBe("update_required");
    expect(markCalendarSyncStale(synced, { scheduledFor: "2026-08-27T10:00:00.000Z" }).googleCalendarSync?.status).toBe("update_required");
    expect(markCalendarSyncStale(synced, { status: "cancelled" }).googleCalendarSync?.status).toBe("update_required");
  });

  it("presents an explicit action for each sync state", () => {
    expect(calendarSyncActionLabel(undefined)).toBe("Add to Google Calendar");
    expect(calendarSyncActionLabel("update_required")).toBe("Update Google Calendar");
    expect(calendarSyncActionLabel("failed")).toBe("Retry Google Calendar sync");
    expect(calendarSyncActionLabel("synced")).toBe("Update Google Calendar");
  });
});
