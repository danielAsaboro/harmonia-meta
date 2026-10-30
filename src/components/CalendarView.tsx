"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CalendarEvent, CalendarItem } from "@/app/api/calendar/route";
import type { ContentItem } from "@/lib/types";
import ItemDrawer from "@/components/calendar/ItemDrawer";
import { Button, IconButton } from "@/components/dashboard/Button";
import { Select } from "@/components/dashboard/Controls";
import { DashboardPage } from "@/components/dashboard/DashboardPage";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { AlertBanner, EmptyState, ErrorState, LoadingState } from "@/components/dashboard/SystemState";
import { Tabs } from "@/components/dashboard/Tabs";
import { calendarAnchor, calendarRequestAction, calendarStatus, groupCalendarItems } from "@/lib/dashboard/calendarPresentation";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const VIEW_TABS = [{ key: "month", label: "Month" }, { key: "agenda", label: "Agenda" }] as const;

function iso(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function friendlyDate(value?: string): string {
  if (!value) return "Unscheduled";
  return new Date(value).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function CalendarView() {
  const router = useRouter();
  const [cursor, setCursor] = useState(() => { const now = new Date(); return { year: now.getFullYear(), month: now.getMonth() }; });
  const [view, setView] = useState<"month" | "agenda">("month");
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [goals, setGoals] = useState<{ weeklyPostTarget?: number } | null>(null);
  const [selectedItem, setSelectedItem] = useState<ContentItem | null>(null);
  const [statusFilter, setStatusFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [googleCalendar, setGoogleCalendar] = useState<{ connected: boolean; calendarTitle?: string } | null>(null);
  const [requestState, setRequestState] = useState<"loading" | "ready" | "error">("loading");
  const [requestError, setRequestError] = useState("");

  const load = useCallback(async () => {
    setRequestState("loading");
    setRequestError("");
    try {
      const [calendarResponse, goalsResponse, googleResponse] = await Promise.all([
        fetch("/api/calendar", { cache: "no-store" }),
        fetch("/api/settings/goals", { cache: "no-store" }),
        fetch("/api/calendar/google", { cache: "no-store" }),
      ]);
      if (!calendarResponse.ok) {
        const action = calendarRequestAction(calendarResponse.status);
        if (action.kind === "reauthenticate") {
          await fetch("/api/auth/session", { method: "DELETE" });
          window.location.assign(action.href);
          return;
        }
        throw new Error(action.message);
      }
      const calendar = await calendarResponse.json();
      setEvents(calendar.events ?? []);
      setItems(calendar.items ?? []);
      if (goalsResponse.ok) {
        const body = await goalsResponse.json();
        setGoals(body.goals ?? null);
      }
      if (googleResponse.ok) setGoogleCalendar(await googleResponse.json());
      setRequestState("ready");
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : "Calendar could not be loaded.");
      setRequestState("error");
    }
  }, []);

  useEffect(() => { const timer = setTimeout(() => void load(), 0); return () => clearTimeout(timer); }, [load]);

  const filteredItems = useMemo(() => items.filter((item) =>
    (!statusFilter || item.status === statusFilter) && (!platformFilter || item.platforms.includes(platformFilter)),
  ), [items, platformFilter, statusFilter]);
  const itemsByDate = useMemo(() => groupCalendarItems(filteredItems), [filteredItems]);
  const jobCreatedDates = useMemo(() => new Set(events.map((event) => event.date)), [events]);
  const agendaItems = useMemo(() => [...filteredItems].filter((item) => calendarAnchor(item)).sort((a, b) => Date.parse(calendarAnchor(a) ?? "") - Date.parse(calendarAnchor(b) ?? "")), [filteredItems]);

  const grid = useMemo(() => {
    const first = new Date(cursor.year, cursor.month, 1);
    const startOffset = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
    const cells: Array<{ date: string | null; day: number | null }> = Array.from({ length: startOffset }, () => ({ date: null, day: null }));
    for (let day = 1; day <= daysInMonth; day += 1) cells.push({ date: iso(new Date(cursor.year, cursor.month, day)), day });
    while (cells.length % 7 !== 0) cells.push({ date: null, day: null });
    return cells;
  }, [cursor]);

  const ghostSlots = useMemo(() => {
    const target = goals?.weeklyPostTarget ?? 0;
    const ghosts = new Map<string, number>();
    if (!target) return ghosts;
    const counts = new Map<string, number>();
    for (const item of filteredItems) {
      if (!["scheduled", "awaiting_final_review", "published", "publishing"].includes(item.status)) continue;
      const anchor = calendarAnchor(item);
      if (!anchor) continue;
      const date = new Date(`${anchor}T12:00:00`);
      const monday = new Date(date);
      monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      counts.set(iso(monday), (counts.get(iso(monday)) ?? 0) + 1);
    }
    for (const cell of grid) {
      if (!cell.date) continue;
      const date = new Date(`${cell.date}T12:00:00`);
      if (date.getDay() !== 0) continue;
      const monday = new Date(date);
      monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
      const missing = target - (counts.get(iso(monday)) ?? 0);
      if (missing > 0) ghosts.set(cell.date, missing);
    }
    return ghosts;
  }, [filteredItems, goals, grid]);

  function shift(delta: number) {
    setSelectedItem(null);
    setCursor(({ year, month }) => { const next = month + delta; return { year: year + Math.floor(next / 12), month: ((next % 12) + 12) % 12 }; });
  }

  function openInChat(item: ContentItem) {
    setSelectedItem(null);
    router.push(`/dashboard?job=${encodeURIComponent(item.jobId)}&item=${encodeURIComponent(item.id)}`);
  }

  const today = iso(new Date());

  return (
    <DashboardPage title="Content calendar" description="Plan, review, and verify every scheduled post without losing the approval boundary." eyebrow="Publishing schedule">
      <AlertBanner
        tone={googleCalendar?.connected ? "success" : "info"}
        title={googleCalendar?.connected ? "Google Calendar connected" : "Keep the external calendar in sync"}
        actions={!googleCalendar?.connected ? <Link href="/dashboard/settings" className="dash-button dash-button--secondary">Connect calendar</Link> : undefined}
      >
        {googleCalendar?.connected
          ? `${googleCalendar.calendarTitle ?? "Harmonia Content Calendar"} is available. Each external change still requires an explicit approved sync.`
          : "Connect Google Calendar to place approved schedule changes in Harmonia’s dedicated calendar."}
      </AlertBanner>

      <div className="calendar-toolbar">
        <div className="calendar-period" aria-label="Calendar period">
          {view === "month" && <IconButton label="Previous month" onClick={() => shift(-1)}>←</IconButton>}
          <strong>{view === "month" ? `${MONTHS[cursor.month]} ${cursor.year}` : "Upcoming schedule"}</strong>
          {view === "month" && <IconButton label="Next month" onClick={() => shift(1)}>→</IconButton>}
        </div>
        <div className="calendar-filters">
          <label><span>Status</span><Select aria-label="Filter calendar by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{["draft", "scheduled", "awaiting_final_review", "published", "failed", "cancelled"].map((status) => <option key={status} value={status}>{calendarStatus(status).label}</option>)}</Select></label>
          <label><span>Channel</span><Select aria-label="Filter calendar by channel" value={platformFilter} onChange={(event) => setPlatformFilter(event.target.value)}><option value="">All channels</option><option value="x">X</option></Select></label>
        </div>
        <Tabs items={VIEW_TABS} selected={view} onSelect={setView} label="Calendar view" />
      </div>

      {requestState === "loading" ? <LoadingState title="Loading content calendar" message="Retrieving scheduled items and verified calendar state." /> : requestState === "error" ? <ErrorState title="Calendar unavailable" message={requestError} action={<Button onClick={() => void load()}>Retry</Button>} /> : (
        <>
          {view === "month" && <div className="calendar-month" aria-label={`${MONTHS[cursor.month]} ${cursor.year} calendar`}>
            <div className="calendar-weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
            <div className="calendar-grid">
              {grid.map((cell, index) => {
                if (!cell.date) return <div key={`empty-${index}`} className="calendar-day calendar-day--outside" aria-hidden="true" />;
                const dayItems = itemsByDate.get(cell.date) ?? [];
                const ghost = ghostSlots.get(cell.date);
                const isToday = cell.date === today;
                return <section key={cell.date} className={`calendar-day ${isToday ? "calendar-day--today" : ""}`} aria-label={`${MONTHS[cursor.month]} ${cell.day}${isToday ? ", today" : ""}`}>
                  <div className="calendar-day__number"><time dateTime={cell.date}>{cell.day}</time>{jobCreatedDates.has(cell.date) && <span title="A content job was created this day">Job created</span>}</div>
                  <div className="calendar-day__items">
                    {dayItems.slice(0, 3).map((item) => { const status = calendarStatus(item.status); return <button key={item.id} type="button" onClick={() => setSelectedItem(item)} className="calendar-item" data-tone={status.tone} title={`${status.label}: ${item.text}`}><span className="calendar-item__status" aria-hidden="true" /><span className="calendar-item__text">{item.text}</span><span className="sr-only">{status.label}; {item.platforms.join(", ")}</span></button>; })}
                    {dayItems.length > 3 && <span className="calendar-day__more">+{dayItems.length - 3} more</span>}
                    {ghost && dayItems.length === 0 && <span className="calendar-cadence">{ghost} open cadence slot{ghost > 1 ? "s" : ""}</span>}
                  </div>
                </section>;
              })}
            </div>
          </div>}

          <div className={`${view === "agenda" ? "calendar-agenda" : "calendar-agenda calendar-agenda--mobile"}`}>
            {agendaItems.length === 0 ? <EmptyState title="No matching calendar items" message="Change the filters or schedule a draft from its content details." /> : <ol>{agendaItems.map((item) => { const status = calendarStatus(item.status); return <li key={item.id}><button type="button" onClick={() => setSelectedItem(item)}><time dateTime={calendarAnchor(item) ?? undefined}>{friendlyDate(item.status === "published" ? item.publishedAt : item.scheduledFor ?? item.createdAt)}</time><div><strong>{item.text}</strong><span>{item.platforms.join(", ")} · {item.publishMode === "auto" ? "Auto-publish" : "Human review"}</span></div><StatusBadge tone={status.tone}>{status.label}</StatusBadge></button></li>; })}</ol>}
          </div>
        </>
      )}

      <div className="calendar-legend" aria-label="Calendar status legend">
        {["draft", "scheduled", "awaiting_final_review", "publishing", "published", "failed", "cancelled"].map((value) => { const status = calendarStatus(value); return <StatusBadge key={value} tone={status.tone}>{status.label}</StatusBadge>; })}
        <span className="calendar-legend__cadence">Dashed items show open cadence slots against the weekly goal.</span>
      </div>

      {selectedItem && <ItemDrawer item={selectedItem} onClose={() => setSelectedItem(null)} onSaved={() => void load()} onOpenInChat={openInChat} />}
    </DashboardPage>
  );
}
