import type { AppNotification } from "@/lib/types";

export type NotificationState =
  | { status: "loading" }
  | { status: "ready"; items: AppNotification[] }
  | { status: "error"; message: string };

export const initialNotificationState = (): NotificationState => ({ status: "loading" });
export const notificationLoadSucceeded = (items: AppNotification[]): NotificationState => ({ status: "ready", items });
export const notificationLoadFailed = (cause: unknown): NotificationState => ({ status: "error", message: cause instanceof Error ? cause.message : "Notifications request failed" });
