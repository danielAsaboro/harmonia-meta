import { describe, expect, it } from "vitest";
import { calendarSyncFailure } from "@/lib/calendarSyncState";
import type { ContentItem } from "@/lib/types";

const item: ContentItem = { id: "i", jobId: "j", text: "post", platforms: ["x"], status: "scheduled", publishMode: "approval", scheduledFor: "2026-08-26T10:00:00.000Z", createdAt: "a", updatedAt: "b", googleCalendarSync: { status: "synced", calendarId: "c", eventId: "e", etag: "tag", htmlLink: "https://calendar.google/e", sourceUpdatedAt: "b", verifiedAt: "v" } };

describe("calendar sync failure state", () => {
  it("preserves external identity while recording a sanitized failure", () => {
    expect(calendarSyncFailure(item, "2026-08-25T12:00:00.000Z", new Error("token abcdefghijklmnopqrstuvwxyz"))).toEqual({
      status: "failed", calendarId: "c", eventId: "e", etag: "tag", htmlLink: "https://calendar.google/e", sourceUpdatedAt: "b", verifiedAt: "v", lastAttemptAt: "2026-08-25T12:00:00.000Z", failureReason: "Google Calendar synchronization failed",
    });
  });
});
