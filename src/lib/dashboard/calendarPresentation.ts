import type { CalendarItem } from "@/app/api/calendar/route";
import type { Tone } from "@/components/dashboard/types";

const STATUS: Record<string, { tone: Tone; label: string }> = {
  draft: { tone: "neutral", label: "Draft" },
  scheduled: { tone: "info", label: "Scheduled" },
  awaiting_final_review: { tone: "warning", label: "Awaiting final review" },
  publishing: { tone: "info", label: "Publishing" },
  published: { tone: "success", label: "Published" },
  failed: { tone: "danger", label: "Failed" },
  cancelled: { tone: "neutral", label: "Cancelled" },
};

export function calendarAnchor(item: CalendarItem): string | null {
  const anchor = item.status === "published"
    ? item.publishedAt ?? item.scheduledFor ?? item.createdAt
    : item.scheduledFor ?? item.createdAt;
  return anchor ? anchor.slice(0, 10) : null;
}

export function calendarStatus(status: string): { tone: Tone; label: string } {
  return STATUS[status] ?? { tone: "neutral", label: status.replaceAll("_", " ") };
}

export function groupCalendarItems(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const grouped = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const anchor = calendarAnchor(item);
    if (!anchor) continue;
    grouped.set(anchor, [...(grouped.get(anchor) ?? []), item]);
  }
  return grouped;
}

export function calendarRequestAction(status: number):
  | { kind: "reauthenticate"; clearSession: true; href: string }
  | { kind: "error"; message: string } {
  if (status === 401) return { kind: "reauthenticate", clearSession: true, href: "/login?returnTo=%2Fdashboard%2Fcalendar" };
  return { kind: "error", message: `Calendar could not be loaded (HTTP ${status}).` };
}
