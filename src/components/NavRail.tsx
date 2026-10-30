"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FocusEvent } from "react";
import { signOut as firebaseSignOut } from "firebase/auth";
import { BrandMark } from "@/components/BrandMark";
import { ConfirmationDialog } from "@/components/dashboard/ConfirmationDialog";
import { ChatIcon, CalendarIcon, ChartIcon, SettingsIcon } from "@/components/icons";
import { clientAuth } from "@/lib/firebaseClient";
import { signOutPersistedSession } from "@/lib/sessionPersistence";
import styles from "./NavRail.module.css";

const RAIL = [
  { href: "/dashboard", label: "Console", Icon: ChatIcon },
  { href: "/dashboard/calendar", label: "Calendar", Icon: CalendarIcon },
  { href: "/dashboard/notifications", label: "Notifications", Icon: BellIcon },
  { href: "/dashboard/monitoring", label: "Monitoring", Icon: ChartIcon },
  { href: "/dashboard/settings", label: "Settings", Icon: SettingsIcon },
];

const HIDE_DELAY_MS = 220;

export const SIGN_OUT_DIALOG = {
  title: "Sign out of Harmonia?",
  description: "Your local session will close. Published content and workspace data remain unchanged.",
  confirmLabel: "Sign out",
} as const;

interface RailPresence {
  pointerInside: boolean;
  focusInside: boolean;
}

type RailPresenceEvent = "pointer-enter" | "pointer-leave" | "focus-enter" | "focus-leave";

export function reduceRailPresence(state: RailPresence, event: RailPresenceEvent): RailPresence {
  switch (event) {
    case "pointer-enter": return { ...state, pointerInside: true };
    case "pointer-leave": return { ...state, pointerInside: false };
    case "focus-enter": return { ...state, focusInside: true };
    case "focus-leave": return { ...state, focusInside: false };
  }
}

export function isRailItemActive(pathname: string, href: string): boolean {
  if (href === "/dashboard") return pathname === href || pathname === `${href}/`;
  return pathname === href || pathname.startsWith(`${href}/`);
}

function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className ?? "h-5 w-5"} aria-hidden>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5" aria-hidden>
      <path d="M10 17l5-5-5-5" />
      <path d="M15 12H3" />
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
    </svg>
  );
}

/** Floating vertical nav rail — a single dynamic-island capsule, vertically centered. */
export default function NavRail() {
  const pathname = usePathname();
  const router = useRouter();
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const logoutRef = useRef<HTMLButtonElement>(null);
  const presence = useRef<RailPresence>({ pointerInside: false, focusInside: false });
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearHideTimer() {
    if (!hideTimer.current) return;
    clearTimeout(hideTimer.current);
    hideTimer.current = null;
  }

  function registerPresence(event: RailPresenceEvent) {
    const next = reduceRailPresence(presence.current, event);
    presence.current = next;
    clearHideTimer();
    if (next.pointerInside || next.focusInside) {
      setOpen(true);
      return;
    }
    hideTimer.current = setTimeout(() => setOpen(false), HIDE_DELAY_MS);
  }

  function leaveFocusRegion(event: FocusEvent<HTMLElement>, region: "trigger" | "rail") {
    if (region === "rail" && event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    registerPresence("focus-leave");
  }

  function cancelSignOut() {
    setSignOutOpen(false);
    requestAnimationFrame(() => logoutRef.current?.focus());
  }

  async function signOut() {
    setSigningOut(true);
    try {
      await signOutPersistedSession(
        () => firebaseSignOut(clientAuth()),
        async () => { await fetch("/api/auth/session", { method: "DELETE" }); },
      );
      router.replace("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  useEffect(() => {
    let alive = true;
    const load = () =>
      fetch("/api/notifications", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (alive && d) setUnread(d.unread ?? 0);
        })
        .catch(() => {});
    const t = setTimeout(load, 0);
    const interval = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearTimeout(t);
      clearInterval(interval);
    };
  }, [pathname]);

  useEffect(() => () => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
  }, []);

  return <>
    <aside className={styles.desktopOnly} aria-label="Dashboard navigation">
      <button
        type="button"
        aria-label="Open navigation"
        aria-controls="dashboard-navigation-rail"
        aria-expanded={open}
        className={styles.trigger}
        onPointerEnter={() => registerPresence("pointer-enter")}
        onPointerLeave={() => registerPresence("pointer-leave")}
        onFocus={() => registerPresence("focus-enter")}
        onBlur={(event) => leaveFocusRegion(event, "trigger")}
      />
      <nav
        id="dashboard-navigation-rail"
        aria-label="Primary"
        aria-hidden={!open}
        inert={!open}
        className={`${styles.rail} ${open ? styles.railOpen : ""}`}
        onPointerEnter={() => registerPresence("pointer-enter")}
        onPointerLeave={() => registerPresence("pointer-leave")}
        onFocusCapture={() => registerPresence("focus-enter")}
        onBlurCapture={(event) => leaveFocusRegion(event, "rail")}
      >
        <div className={styles.island}>
          <Link
            href="/"
            title="Harmonia"
            aria-label="Harmonia home"
            className={styles.logo}
          >
            <BrandMark className="h-full w-full object-contain" decorative />
          </Link>
          <div role="separator" aria-hidden className={styles.separator} />
          {RAIL.map(({ href, label, Icon }) => {
            const active = isRailItemActive(pathname, href);
            const notificationLabel = label === "Notifications" && unread ? `${label} (${unread} unread)` : label;
            return (
              <Link
                key={href}
                href={href}
                title={notificationLabel}
                aria-label={notificationLabel}
                aria-current={active ? "page" : undefined}
                data-tooltip={label}
                data-nav-destination={href}
                className={`${styles.item} ${active ? styles.active : ""} ${label === "Notifications" && unread > 0 ? styles.unread : ""}`}
              >
                <Icon />
                {label === "Notifications" && unread > 0 && (
                  <span className={styles.badge}>
                    {unread > 99 ? "99+" : unread}
                  </span>
                )}
              </Link>
            );
          })}
          <div role="separator" aria-hidden className={styles.separator} />
          <button
            ref={logoutRef}
            type="button"
            onClick={() => setSignOutOpen(true)}
            title="Sign out"
            aria-label="Sign out"
            className={`${styles.item} ${styles.logout}`}
          >
            <LogoutIcon />
          </button>
        </div>
      </nav>
    </aside>
    <ConfirmationDialog
      open={signOutOpen}
      title={SIGN_OUT_DIALOG.title}
      description={SIGN_OUT_DIALOG.description}
      confirmLabel={SIGN_OUT_DIALOG.confirmLabel}
      dangerous
      busy={signingOut}
      onCancel={cancelSignOut}
      onConfirm={() => void signOut()}
    />
  </>;
}
