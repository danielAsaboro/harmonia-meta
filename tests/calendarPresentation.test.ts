import { describe, expect, it } from "vitest";
import { calendarAnchor, calendarRequestAction, calendarStatus } from "@/lib/dashboard/calendarPresentation";
import type { CalendarItem } from "@/app/api/calendar/route";

function item(overrides: Partial<CalendarItem>): CalendarItem {
  return {
    id: "item-1",
    jobId: "job-1",
    text: "A real scheduled post",
    platforms: ["x"],
    status: "draft",
    publishMode: "approval",
    createdAt: "2026-08-20T09:00:00.000Z",
    updatedAt: "2026-08-20T09:00:00.000Z",
    ...overrides,
  };
}

describe("calendar presentation", () => {
  it("uses verified publish time for published items and schedule time otherwise", () => {
    expect(calendarAnchor(item({
      status: "published",
      publishedAt: "2026-08-30T10:00:00.000Z",
      scheduledFor: "2026-08-29T10:00:00.000Z",
    }))).toBe("2026-08-30");
    expect(calendarAnchor(item({
      status: "scheduled",
      scheduledFor: "2026-08-31T10:00:00.000Z",
    }))).toBe("2026-08-31");
  });

  it("falls back to creation time when no schedule or publish time exists", () => {
    expect(calendarAnchor(item({ status: "draft" }))).toBe("2026-08-20");
  });

  it("provides readable semantics for approval and failure", () => {
    expect(calendarStatus("awaiting_final_review")).toEqual({ tone: "warning", label: "Awaiting final review" });
    expect(calendarStatus("failed")).toEqual({ tone: "danger", label: "Failed" });
  });

  it("routes expired sessions through login while retaining real request failures", () => {
    expect(calendarRequestAction(401)).toEqual({ kind: "reauthenticate", clearSession: true, href: "/login?returnTo=%2Fdashboard%2Fcalendar" });
    expect(calendarRequestAction(503)).toEqual({ kind: "error", message: "Calendar could not be loaded (HTTP 503)." });
  });
});
