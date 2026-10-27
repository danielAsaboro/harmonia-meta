import { createHash } from "node:crypto";
import type { ContentItem } from "./types";

export interface GoogleCalendarEventInput {
  id: string;
  summary: string;
  description: string;
  start: { dateTime: string };
  end: { dateTime: string };
  transparency: "transparent";
  extendedProperties: { private: Record<string, string> };
}

export function googleCalendarEventId(scopeKey: string, itemId: string): string {
  return createHash("sha256").update(`${scopeKey}:${itemId}`).digest("hex").slice(0, 32);
}

export function buildGoogleCalendarEvent(
  item: ContentItem,
  eventId: string,
  workspaceId: string,
  brandId: string,
): GoogleCalendarEventInput {
  if (!item.scheduledFor) throw new Error("content item must be scheduled before calendar sync");
  const start = new Date(item.scheduledFor);
  if (Number.isNaN(start.valueOf())) throw new Error("content item has an invalid schedule");
  const end = new Date(start.valueOf() + 30 * 60 * 1000);
  const knownLabels: Record<string, string> = { x: "X", linkedin: "LinkedIn", youtube: "YouTube", tiktok: "TikTok" };
  const labels = item.platforms.map((platform) => knownLabels[platform] ?? `${platform[0]?.toUpperCase() ?? ""}${platform.slice(1)}`);
  return {
    id: eventId,
    summary: `Harmonia · ${labels.join(" + ")}`,
    description: `${item.text}\n\nHarmonia content item: ${item.id}\nJob: ${item.jobId}`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: end.toISOString() },
    transparency: "transparent",
    extendedProperties: { private: {
      harmoniaWorkspaceId: workspaceId,
      harmoniaBrandId: brandId,
      harmoniaContentItemId: item.id,
      harmoniaJobId: item.jobId,
    } },
  };
}
