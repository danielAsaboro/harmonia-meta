"use client";

import AskAiButton from "@/components/AskAiButton";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { ContentItem } from "@/lib/types";
import { PlatformIcon } from "@/components/socialIcons";
import { calendarSyncActionLabel } from "@/lib/calendarSyncState";
import { Button, IconButton } from "@/components/dashboard/Button";
import { Select, Textarea, TextInput } from "@/components/dashboard/Controls";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { AlertBanner } from "@/components/dashboard/SystemState";
import { calendarStatus } from "@/lib/dashboard/calendarPresentation";

interface ConnectionInfo {
  id: string;
  status: string;
  handle?: string;
}

interface JobBundle {
  job: { id: string; sourceAnalysis?: { summary: string }; moments?: Array<{ id: string; title: string }> };
  assets?: Array<{ actionId: string; mime: string }>;
  receipts?: Array<{ actionId: string; outcome: string }>;
  engagement?: Array<{ postId: string; likes: number; reposts: number; url?: string }>;
}

function toLocalInput(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function ItemDrawer({
  item,
  onClose,
  onSaved,
  onOpenInChat,
}: {
  item: ContentItem;
  onClose: () => void;
  onSaved: () => void;
  onOpenInChat: (item: ContentItem) => void;
}) {
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [jobData, setJobData] = useState<JobBundle | null>(null);
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(item.text);
  const [scheduleValue, setScheduleValue] = useState(toLocalInput(item.scheduledFor));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      setDraftText(item.text);
      setScheduleValue(toLocalInput(item.scheduledFor));
      setError(null);
    }, 0);
    return () => clearTimeout(t);
  }, [item.id, item.text, item.scheduledFor]);

  useEffect(() => {
    fetch("/api/settings/connections", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setConnections(d.connections ?? []))
      .catch(() => {});
  }, [item.id]);

  useEffect(() => {
    let alive = true;
    fetch(`/api/jobs/${item.jobId}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("not found"))))
      .then((d) => {
        if (alive) setJobData(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [item.jobId]);

  const immutable = ["published", "publishing"].includes(item.status);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/content-items`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ id: item.id, ...body }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function syncGoogleCalendar(operation: "sync" | "remove") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/calendar/google", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ itemId: item.id, operation }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const channelRows = useMemo(
    () =>
      item.platforms.map((p) => ({
        platform: p,
        conn: connections.find((c) => c.id === p),
      })),
    [item.platforms, connections],
  );

  const publishedEngagement = jobData?.engagement;
  const status = calendarStatus(item.status);

  return (
    <aside className="calendar-drawer" aria-label="Calendar item details">
      <header className="calendar-drawer__header">
        <div className="flex items-center gap-2">
          <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
          <StatusBadge tone={item.publishMode === "auto" ? "info" : "warning"}>{item.publishMode === "auto" ? "Auto-publish" : "Human review"}</StatusBadge>
          <AskAiButton kind="content_item" id={item.id} label={item.text.slice(0, 60)} />
        </div>
        <IconButton onClick={onClose} label="Close calendar item">✕</IconButton>
      </header>

      <div className="calendar-drawer__body">
        {/* Media attached to this post */}
        {item.assetActionIds && item.assetActionIds.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Attached media</h3>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {item.assetActionIds.map((actionId) => {
                const asset = jobData?.assets?.find((a) => a.actionId === actionId);
                if (asset?.mime.startsWith("video/")) {
                  return (
                    <video
                      key={actionId}
                      src={`/api/jobs/${item.jobId}/assets/${actionId}`}
                      controls
                      className="h-40 rounded-lg border border-zinc-200 dark:border-zinc-800"
                    />
                  );
                }
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={actionId}
                    src={`/api/jobs/${item.jobId}/assets/${actionId}`}
                    alt="attached media"
                    className="h-40 rounded-lg border border-zinc-200 object-cover dark:border-zinc-800"
                  />
                );
              })}
            </div>
          </section>
        )}

        {/* Post content */}
        <section>
          <div className="mb-1.5 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Post</h3>
            {!immutable && !editing && (
              <button onClick={() => setEditing(true)} className="text-xs text-blue-600 underline dark:text-blue-400">Edit</button>
            )}
          </div>
          {editing ? (
            <>
              <Textarea
                value={draftText}
                onChange={(e) => setDraftText(e.target.value)}
                rows={4}
              />
              <div className="mt-2 flex items-center gap-2">
                <span className={`text-[11px] ${draftText.length > 280 ? "text-red-500" : "text-zinc-400"}`}>{draftText.length}/280</span>
                <Button
                  variant="primary"
                  onClick={async () => {
                    await patch({ text: draftText });
                    setEditing(false);
                  }}
                  disabled={busy}
                >
                  Save
                </Button>
                <Button
                  variant="quiet"
                  onClick={() => {
                    setDraftText(item.text);
                    setEditing(false);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="whitespace-pre-wrap rounded-lg border border-zinc-200 bg-white p-3 text-sm leading-6 dark:border-zinc-800 dark:bg-zinc-950">
                {item.text}
              </p>
              {(item.revisions?.length ?? 0) > 0 && (
                <p className="mt-1 text-[11px] text-zinc-400">{item.revisions!.length} earlier revision(s) kept in audit trail.</p>
              )}
            </>
          )}
        </section>

        {/* Channels */}
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Channels</h3>
          <ul className="flex flex-col gap-1.5">
            {channelRows.map(({ platform, conn }) => (
              <li key={platform} className="flex items-center gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                <PlatformIcon id={platform} />
                <span className="font-medium capitalize">{platform}</span>
                {conn?.status === "connected" ? (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400">
                    connected{conn.handle ? ` · ${conn.handle}` : ""}
                  </span>
                ) : (
                  <span className="text-[11px] text-amber-600 dark:text-amber-400">not connected — publishing will fail until set up</span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {/* Scheduling */}
        {!immutable && item.status !== "cancelled" && (
          <section>
            <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Schedule</h3>
            <div className="flex items-center gap-2">
              <TextInput
                type="datetime-local"
                value={scheduleValue}
                onChange={(e) => setScheduleValue(e.target.value)}
              />
              <Select
                value={item.publishMode}
                onChange={(e) => patch({ publishMode: e.target.value })}
                disabled={busy}
                className="shrink-0"
                title="Auto publishes when due; approval pauses for your review"
              >
                <option value="approval">review first</option>
                <option value="auto">auto-publish</option>
              </Select>
            </div>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => patch({ scheduledFor: new Date(scheduleValue).toISOString() })}
                disabled={busy || !scheduleValue}
                className="rounded-full bg-sky-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-40"
              >
                {item.scheduledFor ? "Reschedule" : "Schedule"}
              </button>
              <button
                onClick={() => patch({ scheduledFor: new Date().toISOString() })}
                disabled={busy}
                title="Due immediately — auto mode publishes within a minute; review mode asks you first"
                className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-medium hover:bg-zinc-100 disabled:opacity-40 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                Publish now
              </button>
              {item.status !== "draft" && (
                <button
                  onClick={() => patch({ status: "cancelled" })}
                  disabled={busy}
                  className="ml-auto rounded-full border border-red-300 px-4 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:hover:bg-red-950"
                >
                  Cancel post
                </button>
              )}
            </div>
          </section>
        )}

        <section className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/20">
          <h3 className="text-xs font-semibold text-blue-900 dark:text-blue-200">Google Calendar</h3>
          {connections.find((connection) => connection.id === "google-calendar")?.status === "connected" ? (
            <>
              <p className="mt-1 text-xs leading-5 text-blue-700 dark:text-blue-300">
                {item.googleCalendarSync?.status === "synced"
                  ? `Verified ${item.googleCalendarSync.verifiedAt ? new Date(item.googleCalendarSync.verifiedAt).toLocaleString() : "by read-back"}.`
                  : item.googleCalendarSync?.status === "update_required"
                    ? "This item changed after its last verified sync. Google is unchanged until you approve an update."
                    : item.googleCalendarSync?.status === "failed"
                      ? item.googleCalendarSync.failureReason ?? "The last synchronization failed."
                      : item.googleCalendarSync?.status === "removed"
                        ? "The external event was removed and its absence verified."
                        : "No Google Calendar event exists for this item."}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {item.scheduledFor && item.status !== "cancelled" && (
                  <button onClick={() => syncGoogleCalendar("sync")} disabled={busy} className="rounded-full bg-blue-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-blue-500 disabled:opacity-40">
                    {calendarSyncActionLabel(item.googleCalendarSync?.status)}
                  </button>
                )}
                {item.googleCalendarSync?.status === "synced" || item.googleCalendarSync?.status === "update_required" || item.googleCalendarSync?.status === "failed" ? (
                  <button onClick={() => syncGoogleCalendar("remove")} disabled={busy} className="rounded-full border border-blue-300 px-4 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-40 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950">
                    Remove from Google Calendar
                  </button>
                ) : null}
                {item.googleCalendarSync?.htmlLink && (
                  <a href={item.googleCalendarSync.htmlLink} target="_blank" rel="noopener noreferrer" className="self-center text-xs text-blue-700 underline dark:text-blue-300">Open verified event ↗</a>
                )}
              </div>
            </>
          ) : (
            <p className="mt-1 text-xs leading-5 text-blue-700 dark:text-blue-300">
              <Link href="/dashboard/settings" className="font-medium underline">Connect Google Calendar</Link> to sync this schedule into a dedicated Harmonia calendar.
            </p>
          )}
        </section>

        {/* Final review */}
        {item.status === "awaiting_final_review" && (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950/50">
            <h3 className="text-xs font-semibold text-amber-800 dark:text-amber-300">Final review needed</h3>
            <p className="mt-1 text-xs leading-5 text-amber-700 dark:text-amber-400">
              This post is due and waits for your decision.
            </p>
            <div className="mt-2 flex gap-2">
              <button
                onClick={async () => {
                  await fetch(`/api/content-items/${item.id}/approve`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ decision: "approved" }),
                  });
                  onSaved();
                }}
                className="rounded-full bg-emerald-600 px-4 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
              >
                Approve &amp; publish
              </button>
              <button
                onClick={async () => {
                  await fetch(`/api/content-items/${item.id}/approve`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ decision: "rejected" }),
                  });
                  onSaved();
                }}
                className="rounded-full border border-zinc-300 px-4 py-1.5 text-xs font-medium dark:border-zinc-700"
              >
                Reject
              </button>
            </div>
          </section>
        )}

        {/* Provenance + outcome */}
        <section>
          <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-400">Provenance &amp; outcome</h3>
          <dl className="space-y-1 text-xs">
            <div className="flex gap-2"><dt className="w-20 shrink-0 text-zinc-400">Job</dt><dd className="truncate font-mono">{item.jobId}</dd></div>
            {jobData?.job?.sourceAnalysis?.summary && (
              <div className="flex gap-2"><dt className="w-20 shrink-0 text-zinc-400">Source</dt><dd className="truncate">{jobData.job.sourceAnalysis.summary}</dd></div>
            )}
            {item.publishedUrl && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-zinc-400">Live post</dt>
                <dd><a href={item.publishedUrl} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline dark:text-blue-400">open ↗</a></dd>
              </div>
            )}
            {publishedEngagement && publishedEngagement.length > 0 && (
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-zinc-400">Reactions</dt>
                <dd>{publishedEngagement.map((e) => `${e.likes} likes · ${e.reposts} reposts`).join("; ")}</dd>
              </div>
            )}
            {item.failureReason && (
              <div className="flex gap-2"><dt className="w-20 shrink-0 text-zinc-400">Failure</dt><dd className="text-red-600 dark:text-red-400">{item.failureReason}</dd></div>
            )}
          </dl>

          {jobData?.assets && jobData.assets.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[11px] uppercase tracking-wide text-zinc-400">Assets from this job</p>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {jobData.assets.map((a) => (
                  a.mime.startsWith("video/") ? (
                    <video key={a.actionId} src={`/api/jobs/${item.jobId}/assets/${a.actionId}`} controls className="h-24 rounded-lg" />
                  ) : (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={a.actionId} src={`/api/jobs/${item.jobId}/assets/${a.actionId}`} alt="" className="h-24 rounded-lg object-cover" />
                  )
                ))}
              </div>
            </div>
          )}
        </section>

        {error && <AlertBanner tone="danger" title="Calendar action failed">{error}</AlertBanner>}
      </div>

      <footer className="calendar-drawer__footer">
        <Button
          variant="primary"
          onClick={() => onOpenInChat(item)}
          className="w-full"
        >
          Open in chat for further processing →
        </Button>
      </footer>
    </aside>
  );
}
