"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { AppNotification } from "@/lib/types";
import { Button } from "@/components/dashboard/Button";
import { DashboardPage, SectionHeader } from "@/components/dashboard/DashboardPage";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { Surface } from "@/components/dashboard/Surface";
import { EmptyState, ErrorState, LoadingState } from "@/components/dashboard/SystemState";
import { initialNotificationState, notificationLoadFailed, notificationLoadSucceeded, type NotificationState } from "@/lib/dashboard/notificationState";
import type { Tone } from "@/components/dashboard/types";

function group(iso: string): "today" | "earlier" {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString() ? "today" : "earlier";
}

const severityTone = (severity: string): Tone => severity === "critical" ? "danger" : severity === "warning" ? "warning" : "info";

export default function NotificationsPage() {
  const [state, setState] = useState<NotificationState>(initialNotificationState);
  const [actionError, setActionError] = useState("");
  const items = state.status === "ready" ? state.items : [];

  const load = useCallback(() => {
    return fetch("/api/notifications", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => setState(notificationLoadSucceeded(d.notifications)))
      .catch((cause) => setState(notificationLoadFailed(cause)));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function open(n: AppNotification) {
    if (!n.id || n.readAt) {
      if (n.href) window.location.assign(n.href);
      return;
    }
    const response = await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read", id: n.id }),
    });
    if (!response.ok) { setActionError(`Notification could not be marked read (${response.status}).`); return; }
    setActionError("");
    if (n.href) window.location.assign(n.href);
    else void load();
  }

  async function readAll() {
    const response = await fetch("/api/notifications", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "read-all" }),
    });
    if (!response.ok) { setActionError(`Notifications could not be marked read (${response.status}).`); return; }
    setActionError("");
    void load();
  }

  const today = (items ?? []).filter((n) => group(n.createdAt) === "today");
  const earlier = (items ?? []).filter((n) => group(n.createdAt) !== "today");

  function renderList(list: AppNotification[], label: string) {
    if (list.length === 0) return null;
    return (
      <section className="notification-group">
        <SectionHeader title={label} />
        {list.map((n, i) => (
          <Surface as="article" variant="interactive" data-tone={severityTone(n.severity)} className="notification-row"
            key={n.id ?? i}
          >
            <button onClick={() => void open(n)} className="notification-row__button">
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className={`text-sm font-medium ${n.readAt ? "text-zinc-400" : ""}`}>{n.title}</span>
                <StatusBadge tone={severityTone(n.severity)}>{n.kind.replace(/_/g, " ")}</StatusBadge>
              </span>
              <span className="mt-0.5 block text-xs leading-5 text-zinc-600 dark:text-zinc-400">{n.body}</span>
              <span className="mt-1 block text-[10px] text-zinc-400">
                {new Date(n.createdAt).toLocaleString()}
                {n.href && !n.readAt && <span className="ml-2 text-blue-600 underline dark:text-blue-400">view →</span>}
              </span>
            </span>
            </button>
          </Surface>
        ))}
      </section>
    );
  }

  return (
    <DashboardPage title="Notifications" eyebrow="Operator inbox" description="Approvals, failures, and everything needing your attention." actions={
        <Button
          onClick={() => void readAll()}
          disabled={!items.some((n) => !n.readAt)}
        >
          Mark all read
        </Button>}>
      {actionError && <ErrorState title="Notification update failed" message={actionError} />}

      {state.status === "loading" ? (
        <LoadingState title="Loading notifications" />
      ) : state.status === "error" ? <ErrorState title="Notifications could not be loaded" message={state.message} action={<Button onClick={() => void load()}>Retry</Button>} /> : items.length === 0 ? (
        <EmptyState title="Nothing needs your attention right now" message="Approval requests and operational failures will appear here." />
      ) : (
        <>
          {renderList(today, "Today")}
          {renderList(earlier, "Earlier")}
        </>
      )}

      <p className="text-[11px] text-zinc-400">
        Tip: approval notifications deep-link into the pipeline — job rows open in the{" "}
        <Link href="/dashboard" className="underline">console</Link>, calendar items open on the{" "}
        <Link href="/dashboard/calendar" className="underline">calendar</Link>.
      </p>
    </DashboardPage>
  );
}
