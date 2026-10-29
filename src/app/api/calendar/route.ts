import { listContentItems, listJobs } from "@/lib/firestore";
import type { ContentItem } from "@/lib/types";
import { tenantHandler } from "@/lib/auth";

export interface CalendarEvent {
  date: string; // YYYY-MM-DD
  kind: "job_created";
  jobId: string;
  label: string;
}

export interface CalendarItem extends Omit<ContentItem, "updatedAt"> {
  updatedAt: string;
}

/**
 * Calendar feed: content items are the planning surface (draft → scheduled →
 * review → published); job-created markers give creation context.
 */
async function get(_req: Request) {
  const [jobs, items] = await Promise.all([listJobs(100), listContentItems()]);
  const events: CalendarEvent[] = jobs.map((job) => ({
    date: (job.createdAt ?? "").slice(0, 10),
    kind: "job_created" as const,
    jobId: job.id,
    label: job.sourceAnalysis?.summary ?? `Source bundle ${job.config.sourceManifestId.slice(0, 8)}`,
  }));

  return Response.json({
    events,
    items,
    jobTitles: Object.fromEntries(jobs.map((j) => [j.id, j.sourceAnalysis?.summary ?? `Source bundle ${j.config.sourceManifestId.slice(0, 8)}`])),
  });
}

export const GET = tenantHandler(get);
