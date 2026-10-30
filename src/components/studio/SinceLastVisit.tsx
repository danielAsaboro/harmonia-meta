"use client";

import { useEffect, useState } from "react";
import type { TimelineEvent } from "@/components/Timeline";

export function eventsSince<T extends { at?: string | null }>(events: T[], previousVisit: string | null): T[] {
  if (!previousVisit || !Number.isFinite(Date.parse(previousVisit))) return [];
  const threshold = Date.parse(previousVisit);
  return events.filter((event) => Boolean(event.at) && Number.isFinite(Date.parse(event.at!)) && Date.parse(event.at!) > threshold);
}

export function SinceLastVisit({ jobId, updatedAt, events }: { jobId: string; updatedAt: string; events: TimelineEvent[] }) {
  const [unseen, setUnseen] = useState<TimelineEvent[]>([]);
  useEffect(() => {
    const key = `harmonia:last-seen:${jobId}`;
    const previous = window.localStorage.getItem(key);
    const timer = window.setTimeout(() => setUnseen(eventsSince(events, previous)), 0);
    window.localStorage.setItem(key, updatedAt);
    return () => window.clearTimeout(timer);
  }, [events, jobId, updatedAt]);
  if (!unseen.length) return null;
  return <details className="mb-4 rounded-[16px] border border-[#9aacdf] bg-[#eef2ff]">
    <summary className="flex min-h-12 cursor-pointer list-none items-center gap-3 px-4 py-3 text-sm font-bold text-[#213d96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#3157ff]">
      Since you left <span className="ml-auto rounded-full bg-white px-2 py-1 text-xs">{unseen.length} update{unseen.length === 1 ? "" : "s"}</span>
    </summary>
    <ol className="space-y-2 border-t border-[#9aacdf]/60 p-4">{unseen.slice(-5).reverse().map((event, index) => <li key={`${event.at ?? "update"}-${index}`} className="grid grid-cols-[4.5rem_1fr] gap-3 text-sm"><time className="font-mono text-xs text-[#3157ff]">{event.at ? new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "—"}</time><span>{event.message}</span></li>)}</ol>
  </details>;
}
